use crate::{Error, Scope};
use std::net::{IpAddr, Ipv4Addr};
use url::{Host, Url};

/// Conservative positive IPv6 policy plus special-use IPv4 table. Changes require review.
pub const ADDRESS_POLICY_VERSION: &str = "public-targets-1/2026-10-18";

#[derive(Clone, Debug)]
pub struct Target {
    pub(crate) url: Url,
    pub(crate) host: String,
}
impl Target {
    pub fn parse(input: &str, scope: &Scope) -> Result<Self, Error> {
        if input.len() > 8192 || input.chars().any(|c| c.is_control() || c == '\\') {
            return Err(Error::Target);
        }
        let url = Url::parse(input).map_err(|_| Error::Target)?;
        if url.scheme() != "https"
            || url.port_or_known_default() != Some(443)
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
        {
            return Err(Error::Target);
        }
        let host = match url.host().ok_or(Error::Target)? {
            Host::Domain(domain) => {
                if domain.ends_with("..") {
                    return Err(Error::Target);
                }
                let host = domain.trim_end_matches('.').to_ascii_lowercase();
                if !host.contains('.')
                    || host.len() > 253
                    || host.split('.').any(|s| {
                        s.is_empty()
                            || s.len() > 63
                            || s.starts_with('-')
                            || s.ends_with('-')
                            || !s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                    })
                    || [
                        "localhost",
                        "local",
                        "internal",
                        "home",
                        "test",
                        "invalid",
                        "onion",
                    ]
                    .iter()
                    .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
                {
                    return Err(Error::Target);
                }
                host
            }
            Host::Ipv4(ip) => {
                // URL's WHATWG parser accepts octal/hex/short integers; Profile 1 does not.
                let authority = input
                    .split("://")
                    .nth(1)
                    .ok_or(Error::Target)?
                    .split(['/', '?', '#'])
                    .next()
                    .ok_or(Error::Target)?;
                if authority != ip.to_string() && authority != format!("{ip}:443") {
                    return Err(Error::Target);
                }
                if !public_address(ip.into()) {
                    return Err(Error::Target);
                }
                ip.to_string()
            }
            Host::Ipv6(ip) => {
                if !public_address(ip.into()) {
                    return Err(Error::Target);
                }
                format!("[{ip}]")
            }
        };
        let mut url = url;
        url.set_host(Some(&host)).map_err(|_| Error::Target)?;
        match scope {
            Scope::Public => {}
            Scope::Hosts(hosts) => {
                if hosts.is_empty()
                    || !hosts
                        .iter()
                        .any(|h| normalize_host(h).as_deref() == Some(host.as_str()))
                {
                    return Err(Error::Denied);
                }
            }
        }
        Ok(Self { url, host })
    }
    pub fn host(&self) -> &str {
        &self.host
    }
    pub fn url(&self) -> &str {
        self.url.as_str()
    }
    pub fn validate_addresses(&self, addresses: &[IpAddr]) -> Result<(), Error> {
        if addresses.is_empty()
            || addresses.len() > 32
            || addresses.iter().any(|a| !public_address(*a))
        {
            return Err(Error::Target);
        }
        Ok(())
    }
}
fn normalize_host(input: &str) -> Option<String> {
    // Declarations are hosts, optionally :443; paths, credentials and wildcard rules are invalid.
    if input.contains(['/', '@', '?', '#', '*', '\\']) {
        return None;
    }
    Target::parse(&format!("https://{input}/"), &Scope::Public)
        .ok()
        .map(|t| t.host)
}
pub fn public_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => public_v4(ip),
        IpAddr::V6(ip) => {
            let n = u128::from(ip);
            // Only ordinary global unicast. Excludes mapped/compatible, NAT64, local,
            // multicast, 6to4 and all translation mechanisms outside the positive range.
            n >> 125 == 1
                && n >> 105 != u128::from("2001::".parse::<std::net::Ipv6Addr>().unwrap()) >> 105
                && n >> 112 != 0x2002
                && n >> 96 != 0x20010db8
                && n >> 108 != 0x3fff0
        }
    }
}
fn public_v4(ip: Ipv4Addr) -> bool {
    let n = u32::from(ip);
    ![
        (0x00000000, 8),
        (0x0a000000, 8),
        (0x64400000, 10),
        (0x7f000000, 8),
        (0xa9fe0000, 16),
        (0xac100000, 12),
        (0xc0000000, 24),
        (0xc0000200, 24),
        (0xc01fc400, 24),
        (0xc034c100, 24),
        (0xc0586300, 24),
        (0xc0a80000, 16),
        (0xc0af3000, 24),
        (0xc6120000, 15),
        (0xc6336400, 24),
        (0xcb007100, 24),
        (0xe0000000, 3),
    ]
    .iter()
    .any(|(base, bits)| n >> (32 - bits) == base >> (32 - bits))
}
