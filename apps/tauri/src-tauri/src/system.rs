//! Native file saving and external application capabilities.
#[cfg(target_os = "android")]
pub(crate) mod android;
pub(crate) mod capabilities;
pub(crate) mod download;
pub(crate) mod download_directory;
pub(crate) mod download_scheduler;
pub(crate) mod external;
#[cfg(any(mobile, test))]
pub(crate) mod lifecycle;
