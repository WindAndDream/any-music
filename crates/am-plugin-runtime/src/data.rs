use crate::{authority::*, model::*};
use am_plugin_policy::Operation;
use std::collections::BTreeMap;

impl<S: Store, C: Clock, I: Ids> Runtime<S, C, I> {
    /// Returned copies contain only the fields selected by the trusted product entry point.
    pub fn read(
        &mut self,
        caller: &Caller,
        context_id: &str,
        object_id: &str,
    ) -> Result<BTreeMap<Field, String>, Error> {
        let clock = &self.clock;
        self.store.transaction(|ledger| {
            let now = clock.now_ms();
            let (session, context) = bound_context(ledger, caller, context_id, now)?;
            let selected = context
                .selection
                .iter()
                .find(|s| s.id == object_id)
                .ok_or(Error::Denied)?;
            let object = ledger
                .objects
                .get(&object_key(&session.account_scope, object_id))
                .ok_or(Error::Denied)?;
            if selected.version != version(ledger, object) {
                return Err(Error::Conflict);
            }
            let level = selection_level(ledger, &session, &context)?;
            authorize(ledger, &session, &context, Operation::StateRead, level, now)?;
            let annotation = ledger
                .annotations
                .get(&object_key(&session.account_scope, object_id));
            let fields = selected
                .fields
                .iter()
                .map(|field| {
                    let value = if *field == Field::Title {
                        annotation
                            .map(|a| &a.value)
                            .or_else(|| object.fields.get(field))
                    } else {
                        object.fields.get(field)
                    }
                    .ok_or(Error::Denied)?;
                    Ok((*field, value.text.clone()))
                })
                .collect::<Result<_, Error>>()?;
            remember(ledger, &session, level);
            record_delivery(ledger, &session, &context, level)?;
            Ok(fields)
        })
    }

    pub fn state_get(
        &mut self,
        caller: &Caller,
        context_id: &str,
        key: &str,
    ) -> Result<Option<StateValue>, Error> {
        let clock = &self.clock;
        self.store.transaction(|ledger| {
            let now = clock.now_ms();
            let (session, context) = bound_context(ledger, caller, context_id, now)?;
            if !valid_id(key) || !ledger.grants[&session.identity.install_id].state {
                return Err(Error::Denied);
            }
            let value = ledger
                .namespaces
                .get(&session.identity.install_id)
                .and_then(|n| n.get(key))
                .cloned();
            let level = value.as_ref().map_or(Level::L0, |v| v.provenance.level);
            if value
                .as_ref()
                .is_some_and(|v| v.provenance.data_generation != session.identity.data_generation)
            {
                return Err(Error::Denied);
            }
            authorize(ledger, &session, &context, Operation::StateRead, level, now)?;
            remember(ledger, &session, level);
            record_delivery(ledger, &session, &context, level)?;
            Ok(value)
        })
    }

    /// Reservation grants no side effect. Commit repeats every check, including object versions.
    pub fn prepare(&mut self, caller: &Caller, request: WriteRequest) -> Result<String, Error> {
        let ticket = self.ids.next_id();
        let clock = &self.clock;
        self.store.transaction(|ledger| {
            let now = clock.now_ms();
            let (session, context) = bound_context(ledger, caller, &request.context_id, now)?;
            if !valid_id(&request.operation_id) || !valid_id(&ticket) {
                return Err(Error::Denied);
            }
            if let Some(task) = ledger.tasks.values().find(|t| {
                t.identity.install_id == session.identity.install_id
                    && t.identity.data_generation == session.identity.data_generation
                    && t.request.operation_id == request.operation_id
            }) {
                return if task.session_id == session.id
                    && task.epoch == session.epoch
                    && task.request == request
                {
                    Ok(task.id.clone())
                } else {
                    Err(Error::Replay)
                };
            }
            if ledger
                .tasks
                .values()
                .filter(|t| t.session_id == session.id && t.committed_version.is_none())
                .count()
                >= 16
            {
                return Err(Error::Budget);
            }
            if ledger.tasks.len() >= MAX_LEDGER_ROWS || ledger.tasks.contains_key(&ticket) {
                return Err(Error::Budget);
            }
            check_write(ledger, &session, &context, &request, now)?;
            ledger.tasks.insert(
                ticket.clone(),
                Task {
                    id: ticket.clone(),
                    identity: session.identity.clone(),
                    epoch: session.epoch,
                    session_id: session.id,
                    request,
                    committed_version: None,
                },
            );
            Ok(ticket)
        })
    }

    /// Value + provenance + receipt are one transaction. No renderer-side apply callback follows.
    /// The workbench consumes the committed annotation projection; canonical source records stay in S06 storage.
    pub fn commit(&mut self, caller: &Caller, ticket: &str) -> Result<u64, Error> {
        let clock = &self.clock;
        self.store.transaction(|ledger| {
            let now = clock.now_ms();
            validate(ledger)?;
            let task = ledger.tasks.get(ticket).cloned().ok_or(Error::Denied)?;
            let (session, context) = bound_context(ledger, caller, &task.request.context_id, now)?;
            if task.session_id != session.id
                || task.identity != session.identity
                || task.epoch != session.epoch
            {
                return Err(Error::Denied);
            }
            if let Some(version) = task.committed_version {
                return Ok(version);
            }
            let level = check_write(ledger, &session, &context, &task.request, now)?;
            let mut provenance = remember(ledger, &session, level);
            provenance.source_context = context.id;
            let next_version = task
                .request
                .expected_version
                .checked_add(1)
                .ok_or(Error::Conflict)?;
            match task.request.write {
                Write::State {
                    key,
                    schema_version,
                    text,
                } => {
                    ledger
                        .namespaces
                        .entry(session.identity.install_id.clone())
                        .or_default()
                        .insert(
                            key,
                            StateValue {
                                text,
                                version: next_version,
                                schema_version,
                                provenance,
                            },
                        );
                }
                Write::Annotate { object_id, text } => {
                    ledger.annotations.insert(
                        object_key(&session.account_scope, &object_id),
                        Annotation {
                            version: next_version,
                            value: Value { text, provenance },
                        },
                    );
                }
            }
            ledger
                .tasks
                .get_mut(ticket)
                .expect("checked task")
                .committed_version = Some(next_version);
            Ok(next_version)
        })
    }
}

fn record_delivery(
    ledger: &mut Ledger,
    session: &Session,
    context: &Context,
    level: Level,
) -> Result<(), Error> {
    if ledger.deliveries.len() >= MAX_LEDGER_ROWS && !ledger.deliveries.contains_key(&context.id) {
        return Err(Error::Budget);
    }
    let mut provenance = Provenance {
        level,
        source_install: session.identity.install_id.clone(),
        source_context: context.id.clone(),
        generation: session.identity.generation,
        data_generation: session.identity.data_generation,
    };
    if let Some(old) = ledger.deliveries.get(&context.id) {
        provenance.level = provenance.level.max(old.level);
    }
    ledger.deliveries.insert(context.id.clone(), provenance);
    Ok(())
}

pub(crate) fn selection_level(
    ledger: &Ledger,
    session: &Session,
    context: &Context,
) -> Result<Level, Error> {
    let mut level = historical(ledger, &ledger.installs[&session.identity.install_id]);
    for selected in &context.selection {
        let key = object_key(&session.account_scope, &selected.id);
        let object = ledger.objects.get(&key).ok_or(Error::Denied)?;
        if selected.version != version(ledger, object) {
            return Err(Error::Conflict);
        }
        for field in &selected.fields {
            level = level.max(
                object
                    .fields
                    .get(field)
                    .ok_or(Error::Denied)?
                    .provenance
                    .level,
            );
            if *field == Field::Note {
                level = level.max(Level::L2);
            }
            if *field == Field::Title
                && let Some(annotation) = ledger.annotations.get(&key)
            {
                level = level.max(annotation.value.provenance.level);
            }
        }
    }
    Ok(level)
}

fn check_write(
    ledger: &Ledger,
    session: &Session,
    context: &Context,
    request: &WriteRequest,
    now: u64,
) -> Result<Level, Error> {
    let grant = &ledger.grants[&session.identity.install_id];
    let mut level = selection_level(ledger, session, context)?;
    match &request.write {
        Write::State {
            key,
            schema_version,
            text,
        } => {
            if !grant.state || !valid_id(key) || *schema_version == 0 {
                return Err(Error::Denied);
            }
            let namespace = ledger.namespaces.get(&session.identity.install_id);
            let previous = namespace.and_then(|n| n.get(key));
            if previous.map_or(0, |v| v.version) != request.expected_version {
                return Err(Error::Conflict);
            }
            if let Some(previous) = previous {
                level = level.max(previous.provenance.level);
            }
            let size: usize = namespace
                .into_iter()
                .flat_map(|n| n.iter())
                .filter(|(k, _)| *k != key)
                .map(|(k, v)| k.len() + v.text.len())
                .sum();
            if text.len() > MAX_VALUE_BYTES
                || size.saturating_add(key.len()).saturating_add(text.len()) > MAX_NAMESPACE_BYTES
                || namespace.is_some_and(|n| n.len() >= MAX_LEDGER_ROWS && !n.contains_key(key))
            {
                return Err(Error::Budget);
            }
        }
        Write::Annotate { object_id, text } => {
            if !grant.annotate
                || text.is_empty()
                || text.len() > 500
                || text.chars().any(char::is_control)
            {
                return Err(Error::Denied);
            }
            let selected = context
                .selection
                .iter()
                .find(|s| s.id == *object_id && s.fields.contains(&Field::Title))
                .ok_or(Error::Denied)?;
            if selected.version != request.expected_version {
                return Err(Error::Conflict);
            }
            if ledger.annotations.len() >= MAX_LEDGER_ROWS
                && !ledger
                    .annotations
                    .contains_key(&object_key(&session.account_scope, object_id))
            {
                return Err(Error::Budget);
            }
        }
    }
    authorize(ledger, session, context, Operation::StateWrite, level, now)?;
    Ok(level)
}
