//! Short wheel bursts with eased speed and bounded pauses. No autonomous page animation.
use crate::browser::cdp::Cdp;
use rand::{Rng, SeedableRng, rngs::StdRng};
use serde::Deserialize;
use serde_json::json;
use std::{collections::VecDeque, time::Duration};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Target {
    x: f64,
    y: f64,
    viewport_height: f64,
    remaining: f64,
}
impl Target {
    fn valid(&self) -> bool {
        [self.x, self.y, self.viewport_height, self.remaining]
            .into_iter()
            .all(f64::is_finite)
            && self.x >= 0.0
            && self.y >= 0.0
            && self.viewport_height > 0.0
            && self.remaining >= 0.0
    }
}

pub(super) struct Scroller {
    rng: StdRng,
    deltas: VecDeque<f64>,
}
impl Scroller {
    pub fn new() -> Self {
        Self {
            rng: StdRng::from_entropy(),
            deltas: VecDeque::new(),
        }
    }

    pub fn initial_delay(&mut self) -> Duration {
        Duration::from_millis(self.rng.gen_range(180..=420))
    }

    fn pause(&mut self) -> Duration {
        let millis = if self.rng.gen_ratio(1, 6) {
            self.rng.gen_range(900..=1400)
        } else {
            self.rng.gen_range(350..=900)
        };
        Duration::from_millis(millis)
    }

    fn next(&mut self, target: Option<&Target>) -> (Option<f64>, Duration) {
        let Some(target) = target.filter(|target| target.valid() && target.remaining > 0.5) else {
            self.deltas.clear();
            return (None, self.pause());
        };
        if self.deltas.is_empty() {
            let distance = (target.viewport_height * self.rng.gen_range(0.4..=0.7))
                .clamp(160.0, 480.0)
                .min(target.remaining);
            let steps = self.rng.gen_range(16..=22);
            // Integrate smoothstep position: small start/end deltas with a gradual
            // acceleration/deceleration, rather than unrelated random jumps.
            let ease = |t: f64| t * t * (3.0 - 2.0 * t);
            self.deltas.extend((1..=steps).map(|step| {
                distance
                    * (ease(f64::from(step) / f64::from(steps))
                        - ease(f64::from(step - 1) / f64::from(steps)))
            }));
        }
        let planned = self.deltas.pop_front().unwrap();
        let delta = planned.min(target.remaining);
        if delta >= target.remaining {
            self.deltas.clear();
        }
        let delay = if self.deltas.is_empty() {
            self.pause()
        } else {
            Duration::from_millis(self.rng.gen_range(28..=46))
        };
        (Some(delta), delay)
    }

    /// Dispatch just one wheel increment. The search select loop handles responses,
    /// challenges and cancellation between increments; delayed ticks never catch up.
    pub async fn advance(&mut self, cdp: &mut Cdp, session: &str) -> Result<Duration, String> {
        let result = cdp
            .call(
                Some(session),
                "Runtime.evaluate",
                json!({"expression":include_str!("../scroll-page.js"),"returnByValue":true}),
            )
            .await?;
        if result.get("exceptionDetails").is_some() {
            return Err("invalid-response:无法读取官方搜索滚动区域，请重新搜索。".into());
        }
        let target = serde_json::from_value::<Target>(result["result"]["value"].clone()).ok();
        let (delta, delay) = self.next(target.as_ref());
        if let (Some(delta), Some(target)) = (delta, target) {
            cdp.call(
                Some(session),
                "Input.dispatchMouseEvent",
                json!({"type":"mouseWheel","x":target.x,"y":target.y,"deltaX":0,"deltaY":delta}),
            )
            .await?;
        }
        Ok(delay)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seeded(seed: u64) -> Scroller {
        Scroller {
            rng: StdRng::seed_from_u64(seed),
            deltas: VecDeque::new(),
        }
    }
    fn target(remaining: f64) -> Target {
        Target {
            x: 500.0,
            y: 400.0,
            viewport_height: 800.0,
            remaining,
        }
    }

    #[test]
    fn bursts_accelerate_decelerate_and_vary_within_distance_and_time_budgets() {
        let mut distances = Vec::new();
        let mut pauses = Vec::new();
        for seed in 0..32 {
            let mut scroll = seeded(seed);
            assert!((180..=420).contains(&scroll.initial_delay().as_millis()));
            let mut deltas = Vec::new();
            let mut duration = Duration::ZERO;
            loop {
                let (delta, delay) = scroll.next(Some(&target(1000.0)));
                let delta = delta.unwrap();
                assert!(delta > 0.0 && delta <= 45.0);
                deltas.push(delta);
                if scroll.deltas.is_empty() {
                    assert!((350..=1400).contains(&delay.as_millis()));
                    pauses.push(delay);
                    break;
                }
                assert!((28..=46).contains(&delay.as_millis()));
                duration += delay;
            }
            assert!((16..=22).contains(&deltas.len()));
            assert!((420..=966).contains(&duration.as_millis()));
            let middle = deltas[deltas.len() / 2];
            assert!(middle > deltas[0] * 3.0);
            assert!(middle > deltas.last().unwrap() * 3.0);
            let distance: f64 = deltas.iter().sum();
            assert!((320.0..=480.01).contains(&distance));
            distances.push(distance);
        }
        assert!(distances.windows(2).any(|pair| pair[0] != pair[1]));
        assert!(pauses.windows(2).any(|pair| pair[0] != pair[1]));
    }

    #[test]
    fn resized_bottom_missing_or_invalid_target_stops_a_burst_without_spilling_into_window() {
        let mut scroll = seeded(1);
        scroll.next(Some(&target(1000.0)));
        assert!(!scroll.deltas.is_empty());
        assert_eq!(scroll.next(Some(&target(0.75))).0, Some(0.75));
        assert!(scroll.deltas.is_empty());
        for remaining in [0.0, -1.0, f64::INFINITY, f64::NAN] {
            scroll.next(Some(&target(1000.0)));
            assert_eq!(scroll.next(Some(&target(remaining))).0, None);
            assert!(scroll.deltas.is_empty());
        }
        scroll.next(Some(&target(1000.0)));
        assert_eq!(scroll.next(None).0, None);
        assert!(scroll.deltas.is_empty());
    }
}
