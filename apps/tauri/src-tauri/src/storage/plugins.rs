//! Independent plugin authority DB. Product snapshots, accounts and credentials stay elsewhere.
use am_plugin_runtime::{Error, Ledger, MAX_LEDGER_ROWS, Store};
use rusqlite::{Connection, TransactionBehavior, params};
use serde::{Serialize, de::DeserializeOwned};
use std::{collections::BTreeMap, path::Path, time::Duration};

const TABLES: &[&str] = &[
    "installs",
    "grants",
    "sessions",
    "contexts",
    "tasks",
    "namespaces",
    "objects",
    "annotations",
    "deliveries",
    "journal",
    "history",
    "network_grants",
    "exits",
    "outbound_audit",
    "packages",
    "install_journal",
    "revocations",
];
const MAX_DB_PAYLOAD: usize = 16 * 1024 * 1024;

pub(crate) struct PluginStore {
    connection: Connection,
    #[cfg(test)]
    pub fail_before_commit: bool,
}
impl PluginStore {
    pub fn open(path: &Path) -> Result<Self, Error> {
        let mut connection = Connection::open(path).map_err(|_| Error::Storage)?;
        connection
            .busy_timeout(Duration::from_secs(3))
            .map_err(|_| Error::Storage)?;
        connection
            .pragma_update(None, "synchronous", "FULL")
            .map_err(|_| Error::Storage)?;
        connection
            .pragma_update(None, "journal_mode", "DELETE")
            .map_err(|_| Error::Storage)?;
        connection
            .pragma_update(None, "max_page_count", 16384)
            .map_err(|_| Error::Storage)?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| Error::Storage)?;
        let version: u32 = tx
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|_| Error::Corrupt)?;
        if version == 0 {
            let count: u32 = tx
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table'",
                    [],
                    |row| row.get(0),
                )
                .map_err(|_| Error::Corrupt)?;
            if count != 0 {
                return Err(Error::Corrupt);
            }
            for table in TABLES {
                // Names are compile-time constants, never plugin input.
                tx.execute_batch(&format!("CREATE TABLE {table} (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL) STRICT;")).map_err(|_| Error::Storage)?;
            }
            tx.pragma_update(None, "user_version", 3)
                .map_err(|_| Error::Storage)?;
            let initial = serde_json::to_string(&am_plugin_runtime::Revocations::default())
                .map_err(|_| Error::Storage)?;
            tx.execute(
                "INSERT INTO revocations (id,payload) VALUES ('authority',?1)",
                params![initial],
            )
            .map_err(|_| Error::Storage)?;
        } else if version != 3 {
            return Err(Error::Corrupt);
        }
        tx.commit().map_err(|_| Error::Storage)?;
        Ok(Self {
            connection,
            #[cfg(test)]
            fail_before_commit: false,
        })
    }
}

impl Store for PluginStore {
    fn transaction<T>(
        &mut self,
        change: impl FnOnce(&mut Ledger) -> Result<T, Error>,
    ) -> Result<T, Error> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| Error::Storage)?;
        if tx
            .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .map_err(|_| Error::Corrupt)?
            != 3
        {
            return Err(Error::Corrupt);
        }
        let mut bytes = 0;
        let mut ledger = Ledger::default();
        macro_rules! load {
            ($($name:ident),+ $(,)?) => { $(ledger.$name = read_table(&tx, stringify!($name), &mut bytes)?;)+ };
        }
        load!(
            installs,
            grants,
            sessions,
            contexts,
            tasks,
            namespaces,
            objects,
            annotations,
            deliveries,
            journal,
            history,
            network_grants,
            exits,
            outbound_audit,
            packages,
            install_journal
        );
        let mut revocations: BTreeMap<String, am_plugin_runtime::Revocations> =
            read_table(&tx, "revocations", &mut bytes)?;
        if revocations.len() > 1 || revocations.keys().any(|key| key != "authority") {
            return Err(Error::Corrupt);
        }
        ledger.revocations = revocations.remove("authority").ok_or(Error::Corrupt)?;
        let result = change(&mut ledger)?;
        bytes = 0;
        macro_rules! save {
            ($($name:ident),+ $(,)?) => { $(write_table(&tx, stringify!($name), &ledger.$name, &mut bytes)?;)+ };
        }
        save!(
            installs,
            grants,
            sessions,
            contexts,
            tasks,
            namespaces,
            objects,
            annotations,
            deliveries,
            journal,
            history,
            network_grants,
            exits,
            outbound_audit,
            packages,
            install_journal
        );
        write_table(
            &tx,
            "revocations",
            &BTreeMap::from([("authority".to_owned(), &ledger.revocations)]),
            &mut bytes,
        )?;
        #[cfg(test)]
        if self.fail_before_commit {
            return Err(Error::Storage);
        }
        tx.commit().map_err(|_| Error::Storage)?;
        Ok(result)
    }
}

fn read_table<T: DeserializeOwned>(
    tx: &rusqlite::Transaction<'_>,
    table: &str,
    bytes: &mut usize,
) -> Result<BTreeMap<String, T>, Error> {
    let mut stmt = tx
        .prepare(&format!(
            "SELECT id, payload FROM {table} LIMIT {}",
            MAX_LEDGER_ROWS + 1
        ))
        .map_err(|_| Error::Corrupt)?;
    let mut rows = stmt.query([]).map_err(|_| Error::Corrupt)?;
    let mut values = BTreeMap::new();
    while let Some(row) = rows.next().map_err(|_| Error::Corrupt)? {
        // Check SQLite byte length before copying the cell into Rust memory.
        let id_ref = row.get_ref(0).map_err(|_| Error::Corrupt)?;
        let payload_ref = row.get_ref(1).map_err(|_| Error::Corrupt)?;
        let id = id_ref.as_str().map_err(|_| Error::Corrupt)?;
        let payload = payload_ref.as_str().map_err(|_| Error::Corrupt)?;
        *bytes = bytes.saturating_add(id.len()).saturating_add(payload.len());
        if *bytes > MAX_DB_PAYLOAD || values.len() >= MAX_LEDGER_ROWS {
            return Err(Error::Budget);
        }
        // The DB is native-owned, not a second untrusted wire parser.
        let value = serde_json::from_str(payload).map_err(|_| Error::Corrupt)?;
        values.insert(id.to_owned(), value);
    }
    Ok(values)
}

fn write_table<T: Serialize>(
    tx: &rusqlite::Transaction<'_>,
    table: &str,
    values: &BTreeMap<String, T>,
    bytes: &mut usize,
) -> Result<(), Error> {
    if values.len() > MAX_LEDGER_ROWS {
        return Err(Error::Budget);
    }
    tx.execute(&format!("DELETE FROM {table}"), [])
        .map_err(|_| Error::Storage)?;
    let mut stmt = tx
        .prepare(&format!(
            "INSERT INTO {table} (id, payload) VALUES (?1, ?2)"
        ))
        .map_err(|_| Error::Storage)?;
    for (id, value) in values {
        let payload = serde_json::to_string(value).map_err(|_| Error::Storage)?;
        *bytes = bytes.saturating_add(id.len()).saturating_add(payload.len());
        if *bytes > MAX_DB_PAYLOAD {
            return Err(Error::Budget);
        }
        stmt.execute(params![id, payload])
            .map_err(|_| Error::Storage)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
