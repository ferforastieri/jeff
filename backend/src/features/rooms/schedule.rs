//! Routine schedules. Everything is computed in the routine's own timezone:
//! a daily 08:00 is 08:00 local even across a DST change, and a missed tick
//! runs once with the latest missed occurrence instead of firing a burst.

use std::str::FromStr;

use chrono::{Datelike, LocalResult, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Timelike, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};

pub const MIN_INTERVAL_MINUTES: u32 = 3;
const MAX_DAYS: i64 = 366 * 5;
const MAX_VALIDITY_MINUTES: i64 = 180;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Schedule {
    #[serde(rename = "hourly")]
    Hourly { minute: u8 },
    #[serde(rename = "daily")]
    Daily { time: String },
    #[serde(rename = "weekdays")]
    Weekdays { time: String },
    #[serde(rename = "weekly")]
    Weekly { weekday: u8, time: String },
    #[serde(rename = "monthly")]
    Monthly { day: u8, time: String },
    #[serde(rename = "interval")]
    Interval {
        amount: u32,
        unit: IntervalUnit,
        anchor_at: i64,
    },
    #[serde(rename = "advanced")]
    Advanced {
        months: Vec<u8>,
        days: DaySelection,
        time: TimeSelection,
    },
    #[serde(rename = "custom")]
    Custom { expression: String },
    #[serde(rename = "once")]
    Once { date: String, time: String },
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum IntervalUnit {
    Minutes,
    Hours,
    Days,
}

impl IntervalUnit {
    fn millis(self, amount: u32) -> i64 {
        match self {
            Self::Minutes => amount as i64 * 60_000,
            Self::Hours => amount as i64 * 3_600_000,
            Self::Days => amount as i64 * 86_400_000,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum DaySelection {
    EveryDay,
    DaysOfWeek { days: Vec<u8> },
    DaysOfMonth { days: Vec<u8> },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum TimeSelection {
    AtTime { time: String },
    Every { amount: u32, unit: IntervalUnit },
}

impl Schedule {
    pub fn validate(&self, timezone: &str) -> Result<(), String> {
        let tz = parse_tz(timezone)?;
        match self {
            Self::Hourly { minute } => {
                if *minute > 59 {
                    return Err("Minuto inválido.".into());
                }
            }
            Self::Daily { time } | Self::Weekdays { time } => {
                parse_time_str(time)?;
            }
            Self::Weekly { weekday, time } => {
                if *weekday > 6 {
                    return Err("Dia da semana inválido.".into());
                }
                parse_time_str(time)?;
            }
            Self::Monthly { day, time } => {
                if !(1..=31).contains(day) {
                    return Err("Dia do mês inválido.".into());
                }
                parse_time_str(time)?;
            }
            Self::Interval {
                amount,
                unit,
                anchor_at,
            } => {
                if *amount == 0 {
                    return Err("Intervalo inválido.".into());
                }
                if unit.millis(*amount) < min_interval_ms() {
                    return Err(format!(
                        "O intervalo mínimo é de {MIN_INTERVAL_MINUTES} minutos."
                    ));
                }
                if *anchor_at <= 0 {
                    return Err("Âncora inválida.".into());
                }
            }
            Self::Advanced { months, days, time } => {
                if months.iter().any(|month| !(1..=12).contains(month)) {
                    return Err("Mês inválido.".into());
                }
                match days {
                    DaySelection::EveryDay => {}
                    DaySelection::DaysOfWeek { days } => {
                        if days.is_empty() || days.iter().any(|day| *day > 6) {
                            return Err("Dia da semana inválido.".into());
                        }
                    }
                    DaySelection::DaysOfMonth { days } => {
                        if days.is_empty() || days.iter().any(|day| !(1..=31).contains(day)) {
                            return Err("Dia do mês inválido.".into());
                        }
                    }
                }
                match time {
                    TimeSelection::AtTime { time } => {
                        parse_time_str(time)?;
                    }
                    TimeSelection::Every { amount, unit } => {
                        if *amount == 0 || unit.millis(*amount) < min_interval_ms() {
                            return Err(format!(
                                "O intervalo mínimo é de {MIN_INTERVAL_MINUTES} minutos."
                            ));
                        }
                    }
                }
            }
            Self::Custom { expression } => {
                let spec = CronSpec::parse(expression)?;
                let mut previous = next_cron(&spec, tz, Utc::now().timestamp_millis())?;
                for _ in 0..200 {
                    let next = next_cron(&spec, tz, previous)?;
                    if next - previous < min_interval_ms() {
                        return Err(format!(
                            "A expressão roda mais de uma vez a cada {MIN_INTERVAL_MINUTES} minutos."
                        ));
                    }
                    previous = next;
                }
            }
            Self::Once { date, time } => {
                parse_date_str(date)?;
                parse_time_str(time)?;
            }
        }
        Ok(())
    }

    /// First occurrence strictly after `after` (ms since epoch).
    pub fn next_occurrence(&self, timezone: &str, after: i64) -> Result<i64, String> {
        let tz = parse_tz(timezone)?;
        let local = Utc
            .timestamp_millis_opt(after)
            .single()
            .ok_or_else(|| "Instante inválido.".to_string())?
            .with_timezone(&tz);

        match self {
            Self::Hourly { minute } => {
                let mut candidate = local
                    .date_naive()
                    .and_hms_opt(local.hour(), *minute as u32, 0)
                    .ok_or_else(|| "Hora inválida.".to_string())?;
                if candidate <= local.naive_local() {
                    candidate += chrono::Duration::hours(1);
                }
                let mut result = resolve(tz, candidate)?;
                while result <= after {
                    candidate += chrono::Duration::hours(1);
                    result = resolve(tz, candidate)?;
                }
                Ok(result)
            }
            Self::Daily { time } => daily_like(tz, after, None, None, time),
            Self::Weekdays { time } => {
                daily_like(tz, after, None, Some(WeekdayRule::Weekdays), time)
            }
            Self::Weekly { weekday, time } => daily_like(tz, after, Some(*weekday), None, time),
            Self::Monthly { day, time } => {
                let time = parse_time_str(time)?;
                let start = local.date_naive();
                for offset in 0..=36 {
                    let (year, month) = add_months(start.year(), start.month() as i32, offset);
                    let Some(date) = NaiveDate::from_ymd_opt(year, month, *day as u32) else {
                        continue;
                    };
                    let candidate = date.and_time(time);
                    if candidate <= local.naive_local() {
                        continue;
                    }
                    let result = resolve(tz, candidate)?;
                    if result > after {
                        return Ok(result);
                    }
                }
                Err("Sem próxima ocorrência mensal.".into())
            }
            Self::Interval {
                amount,
                unit,
                anchor_at,
            } => {
                let step = unit.millis(*amount);
                if after < *anchor_at {
                    return Ok(*anchor_at);
                }
                let elapsed = after - anchor_at;
                Ok(anchor_at + (elapsed / step + 1) * step)
            }
            Self::Advanced { months, days, time } => advanced(tz, after, months, days, time),
            Self::Custom { expression } => {
                let spec = CronSpec::parse(expression)?;
                next_cron(&spec, tz, after)
            }
            Self::Once { date, time } => {
                let date = parse_date_str(date)?;
                let time = parse_time_str(time)?;
                let candidate = date.and_time(time);
                let result = resolve(tz, candidate)?;
                if result <= after {
                    return Err("Esta rotina única já passou.".into());
                }
                Ok(result)
            }
        }
    }
}

/// The single run a late tick gets, plus the next future occurrence.
pub fn collapse_missed(
    schedule: &Schedule,
    timezone: &str,
    from: i64,
    now: i64,
) -> Result<(i64, i64), String> {
    let mut scheduled_for = from;
    let mut next = schedule.next_occurrence(timezone, scheduled_for)?;
    while next <= now {
        scheduled_for = next;
        next = schedule.next_occurrence(timezone, scheduled_for)?;
    }
    Ok((scheduled_for, next))
}

fn daily_like(
    tz: Tz,
    after: i64,
    weekday: Option<u8>,
    rule: Option<WeekdayRule>,
    time: &str,
) -> Result<i64, String> {
    let local = Utc
        .timestamp_millis_opt(after)
        .single()
        .ok_or_else(|| "Instante inválido.".to_string())?
        .with_timezone(&tz);
    let time = parse_time_str(time)?;
    let start = local.date_naive();
    for offset in 0..=MAX_DAYS {
        let Some(date) = start.checked_add_signed(chrono::Duration::days(offset)) else {
            break;
        };
        if let Some(weekday) = weekday {
            if date.weekday().num_days_from_sunday() != weekday as u32 {
                continue;
            }
        }
        if rule == Some(WeekdayRule::Weekdays)
            && matches!(date.weekday(), chrono::Weekday::Sat | chrono::Weekday::Sun)
        {
            continue;
        }
        let candidate = date.and_time(time);
        if candidate <= local.naive_local() {
            continue;
        }
        let result = resolve(tz, candidate)?;
        if result > after {
            return Ok(result);
        }
    }
    Err("Sem próxima ocorrência.".into())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum WeekdayRule {
    Weekdays,
}

fn advanced(
    tz: Tz,
    after: i64,
    months: &[u8],
    days: &DaySelection,
    time: &TimeSelection,
) -> Result<i64, String> {
    let local = Utc
        .timestamp_millis_opt(after)
        .single()
        .ok_or_else(|| "Instante inválido.".to_string())?
        .with_timezone(&tz);
    let start = local.date_naive();
    for offset in 0..=MAX_DAYS {
        let Some(date) = start.checked_add_signed(chrono::Duration::days(offset)) else {
            break;
        };
        if !months.is_empty() && !months.contains(&(date.month() as u8)) {
            continue;
        }
        let day_matches = match days {
            DaySelection::EveryDay => true,
            DaySelection::DaysOfWeek { days } => {
                days.contains(&(date.weekday().num_days_from_sunday() as u8))
            }
            DaySelection::DaysOfMonth { days } => days.contains(&(date.day() as u8)),
        };
        if !day_matches {
            continue;
        }
        let candidates = match time {
            TimeSelection::AtTime { time } => vec![date.and_time(parse_time_str(time)?)],
            TimeSelection::Every { amount, unit } => {
                let step = match unit {
                    IntervalUnit::Minutes => *amount as i64,
                    IntervalUnit::Hours => *amount as i64 * 60,
                    IntervalUnit::Days => return Err("Unidade inválida.".into()),
                };
                let midnight = date.and_hms_opt(0, 0, 0).unwrap();
                let mut items = Vec::new();
                let mut minute = 0i64;
                while minute < 1440 {
                    items.push(midnight + chrono::Duration::minutes(minute));
                    minute += step;
                }
                items
            }
        };
        for candidate in candidates {
            if candidate <= local.naive_local() {
                continue;
            }
            let result = resolve(tz, candidate)?;
            if result > after {
                return Ok(result);
            }
        }
    }
    Err("Sem próxima ocorrência.".into())
}

fn min_interval_ms() -> i64 {
    MIN_INTERVAL_MINUTES as i64 * 60_000
}

fn parse_tz(value: &str) -> Result<Tz, String> {
    Tz::from_str(value.trim()).map_err(|_| format!("Fuso horário inválido: {value}"))
}

fn parse_time_str(value: &str) -> Result<NaiveTime, String> {
    NaiveTime::parse_from_str(value.trim(), "%H:%M")
        .map_err(|_| format!("Horário inválido: {value}"))
}

fn parse_date_str(value: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map_err(|_| format!("Data inválida: {value}"))
}

/// Local naive time to epoch ms. A nonexistent wall time (DST jump) moves
/// forward until the clock reads a real minute; an ambiguous one takes the
/// first reading.
fn resolve(tz: Tz, naive: NaiveDateTime) -> Result<i64, String> {
    match tz.from_local_datetime(&naive) {
        LocalResult::Single(value) => Ok(value.timestamp_millis()),
        LocalResult::Ambiguous(first, _) => Ok(first.timestamp_millis()),
        LocalResult::None => {
            for step in 1..=MAX_VALIDITY_MINUTES {
                let candidate = naive + chrono::Duration::minutes(step);
                if let Some(value) = tz.from_local_datetime(&candidate).earliest() {
                    return Ok(value.timestamp_millis());
                }
            }
            Err("Horário inexistente no fuso.".into())
        }
    }
}

fn add_months(year: i32, month: i32, offset: i64) -> (i32, u32) {
    let total = year as i64 * 12 + (month as i64 - 1) + offset;
    let next_year = total.div_euclid(12) as i32;
    let next_month = total.rem_euclid(12) as u32 + 1;
    (next_year, next_month)
}

// --- cron ---------------------------------------------------------------

#[derive(Clone, Debug)]
struct CronField {
    values: Vec<u32>,
    star: bool,
}

#[derive(Clone, Debug)]
struct CronSpec {
    minutes: CronField,
    hours: CronField,
    days: CronField,
    months: CronField,
    weekdays: CronField,
}

impl CronSpec {
    fn parse(expression: &str) -> Result<Self, String> {
        let parts: Vec<&str> = expression.split_whitespace().collect();
        if parts.len() != 5 {
            return Err("A expressão cron precisa de 5 campos.".into());
        }
        Ok(Self {
            minutes: parse_field(parts[0], 0, 59)?,
            hours: parse_field(parts[1], 0, 23)?,
            days: parse_field(parts[2], 1, 31)?,
            months: parse_field(parts[3], 1, 12)?,
            weekdays: parse_field(parts[4], 0, 6)?,
        })
    }
}

fn parse_field(value: &str, min: u32, max: u32) -> Result<CronField, String> {
    let star = value.trim() == "*" || value.trim() == "?";
    let mut values = Vec::new();
    for part in value.split(',') {
        let part = part.trim();
        if part.is_empty() {
            return Err("Campo cron vazio.".into());
        }
        let (range, step) = match part.split_once('/') {
            Some((range, step)) => (
                range,
                step.parse::<u32>()
                    .map_err(|_| "Passo de cron inválido.".to_string())?,
            ),
            None => (part, 1),
        };
        if step == 0 {
            return Err("Passo de cron inválido.".into());
        }
        let (start, end) = if range == "*" || range == "?" {
            (min, max)
        } else if let Some((start, end)) = range.split_once('-') {
            (
                start
                    .parse::<u32>()
                    .map_err(|_| "Valor de cron inválido.".to_string())?,
                end.parse::<u32>()
                    .map_err(|_| "Valor de cron inválido.".to_string())?,
            )
        } else {
            let single = range
                .parse::<u32>()
                .map_err(|_| "Valor de cron inválido.".to_string())?;
            (single, single)
        };
        if start > end || start < min || end > max {
            return Err("Intervalo de cron fora do permitido.".into());
        }
        let mut current = start;
        while current <= end {
            values.push(current);
            current += step;
        }
    }
    values.sort_unstable();
    values.dedup();
    if values.is_empty() {
        return Err("Campo cron sem valores.".into());
    }
    Ok(CronField { values, star })
}

fn next_cron(spec: &CronSpec, tz: Tz, after: i64) -> Result<i64, String> {
    let local = Utc
        .timestamp_millis_opt(after)
        .single()
        .ok_or_else(|| "Instante inválido.".to_string())?
        .with_timezone(&tz);
    let start = local.date_naive();
    for offset in 0..=MAX_DAYS {
        let Some(date) = start.checked_add_signed(chrono::Duration::days(offset)) else {
            break;
        };
        if !spec.months.values.contains(&(date.month() as u32)) {
            continue;
        }
        let dom = spec.days.values.contains(&(date.day() as u32));
        let dow = spec
            .weekdays
            .values
            .contains(&date.weekday().num_days_from_sunday());
        let day_matches = if spec.days.star && spec.weekdays.star {
            true
        } else if spec.days.star {
            dow
        } else if spec.weekdays.star {
            dom
        } else {
            dom || dow
        };
        if !day_matches {
            continue;
        }
        for hour in &spec.hours.values {
            for minute in &spec.minutes.values {
                let Some(candidate) = date.and_hms_opt(*hour, *minute, 0) else {
                    continue;
                };
                if candidate <= local.naive_local() {
                    continue;
                }
                let result = resolve(tz, candidate)?;
                if result > after {
                    return Ok(result);
                }
            }
        }
    }
    Err("A expressão cron não tem próxima ocorrência.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(value: &str) -> i64 {
        NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M")
            .unwrap()
            .and_utc()
            .timestamp_millis()
    }

    fn local(value: &str) -> String {
        value.into()
    }

    #[test]
    fn daily_respects_the_timezone() {
        let schedule = Schedule::Daily {
            time: local("08:00"),
        };
        let next = schedule
            .next_occurrence("America/Sao_Paulo", at("2026-11-22 12:00"))
            .unwrap();
        let dt = Utc
            .timestamp_millis_opt(next)
            .unwrap()
            .with_timezone(&Tz::from_str("America/Sao_Paulo").unwrap());
        assert_eq!(dt.format("%Y-%m-%d %H:%M").to_string(), "2026-11-23 08:00");
    }

    #[test]
    fn interval_is_strictly_after() {
        let anchor = at("2026-11-22 00:00");
        let schedule = Schedule::Interval {
            amount: 30,
            unit: IntervalUnit::Minutes,
            anchor_at: anchor,
        };
        let next = schedule.next_occurrence("UTC", anchor + 60_000).unwrap();
        assert_eq!(next - anchor, 30 * 60_000);
        assert_eq!(
            schedule.next_occurrence("UTC", anchor).unwrap() - anchor,
            30 * 60_000
        );
    }

    #[test]
    fn weekly_skips_to_the_right_weekday() {
        // 2026-11-22 is a Sunday; weekday 1 is Monday.
        let schedule = Schedule::Weekly {
            weekday: 1,
            time: local("09:30"),
        };
        let next = schedule
            .next_occurrence("UTC", at("2026-11-22 12:00"))
            .unwrap();
        let dt = Utc.timestamp_millis_opt(next).unwrap();
        assert_eq!(dt.format("%Y-%m-%d %H:%M").to_string(), "2026-11-23 09:30");
    }

    #[test]
    fn monthly_skips_a_month_without_the_day() {
        let schedule = Schedule::Monthly {
            day: 31,
            time: local("10:00"),
        };
        let next = schedule
            .next_occurrence("UTC", at("2026-11-01 00:00"))
            .unwrap();
        let dt = Utc.timestamp_millis_opt(next).unwrap();
        assert_eq!(dt.format("%Y-%m-%d %H:%M").to_string(), "2026-12-31 10:00");
    }

    #[test]
    fn cron_runs_on_weekdays() {
        let schedule = Schedule::Custom {
            expression: "0 9 * * 1-5".into(),
        };
        // Sunday 2026-11-22 -> Monday 2026-11-23 09:00.
        let next = schedule
            .next_occurrence("UTC", at("2026-11-22 12:00"))
            .unwrap();
        let dt = Utc.timestamp_millis_opt(next).unwrap();
        assert_eq!(dt.format("%Y-%m-%d %H:%M").to_string(), "2026-11-23 09:00");
    }

    #[test]
    fn missed_occurrences_collapse_to_one() {
        let schedule = Schedule::Daily {
            time: local("08:00"),
        };
        let from = at("2026-11-20 08:00");
        let now = at("2026-11-22 12:00");
        let (scheduled_for, next) = collapse_missed(&schedule, "UTC", from, now).unwrap();
        assert_eq!(
            Utc.timestamp_millis_opt(scheduled_for)
                .unwrap()
                .format("%Y-%m-%d %H:%M")
                .to_string(),
            "2026-11-22 08:00"
        );
        assert_eq!(
            Utc.timestamp_millis_opt(next)
                .unwrap()
                .format("%Y-%m-%d %H:%M")
                .to_string(),
            "2026-11-23 08:00"
        );
    }

    #[test]
    fn rejects_schedules_that_run_too_often() {
        let custom = Schedule::Custom {
            expression: "* * * * *".into(),
        };
        assert!(custom.validate("UTC").is_err());
        let interval = Schedule::Interval {
            amount: 1,
            unit: IntervalUnit::Minutes,
            anchor_at: at("2026-11-22 00:00"),
        };
        assert!(interval.validate("UTC").is_err());
    }

    #[test]
    fn accepts_a_valid_advanced_schedule() {
        let schedule = Schedule::Advanced {
            months: vec![11],
            days: DaySelection::DaysOfWeek { days: vec![1, 3] },
            time: TimeSelection::AtTime {
                time: local("07:15"),
            },
        };
        schedule.validate("America/Sao_Paulo").unwrap();
        assert!(schedule
            .next_occurrence("America/Sao_Paulo", at("2026-11-22 12:00"))
            .is_ok());
    }
}
