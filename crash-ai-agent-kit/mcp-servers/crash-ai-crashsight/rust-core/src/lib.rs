use anyhow::{Context, Result, anyhow};
use base64::Engine;
use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeZone};
use futures::{StreamExt, stream};
use hmac::{Hmac, Mac};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::Sha256;
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    env,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Default, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReportInput {
    pub date: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub platform: Option<Value>,
    pub platforms: Option<Vec<Value>>,
    pub version_filters: Option<Vec<String>>,
    pub branches: Option<Vec<String>>,
    pub include_redmine: Option<bool>,
    pub top_n: Option<usize>,
    pub page_size: Option<usize>,
    pub max_pages: Option<usize>,
}

#[derive(Debug, Clone)]
struct Config {
    base_url: String,
    redmine_base_url: String,
    local_user_id: String,
    openapi_key: String,
    app_ids: HashMap<String, String>,
    branch_filters: BTreeMap<String, String>,
    crash_concurrency: usize,
    redmine_concurrency: usize,
    redmine_api_key: String,
}

#[derive(Debug, Clone)]
struct Platform {
    id: u32,
    label: &'static str,
    app_id: String,
}

#[derive(Debug, Clone)]
struct DateRange {
    start_date: String,
    end_date: String,
    start_time: String,
    end_time: String,
    start_ms: i64,
    end_ms: i64,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub markdown: String,
    pub summary: ReportSummary,
    pub rows: Vec<IssueRow>,
    pub redmine: Vec<RedmineInfo>,
    pub errors: Vec<ReportError>,
    pub timing_ms: TimingMs,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReportSummary {
    pub total_issues: usize,
    pub raw_issue_count: usize,
    pub api_row_count: usize,
    pub filtered_out_by_date: usize,
    pub potential_duplicate_issue_count: usize,
    pub cross_version_duplicate_issue_count: usize,
    pub pages_scanned: usize,
    pub possibly_truncated: bool,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TimingMs {
    pub total: u128,
    pub crash_sight: u128,
    pub redmine: u128,
    pub render: u128,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IssueRow {
    pub id: usize,
    pub platform: String,
    pub issue_id: String,
    pub crash_sight_link: String,
    pub total_crash_num: u64,
    pub total_affected_devices: u64,
    pub first_seen_time: String,
    pub latest_upload_time: String,
    pub first_seen_version: String,
    pub application_version: String,
    pub continued_version_count: usize,
    pub tags: Vec<String>,
    pub redmine_refs: Vec<u64>,
    pub redmine_links: Vec<String>,
    pub redmine_status: String,
    pub redmine_owner: String,
    pub judgement: String,
    pub next_step: String,
    pub version_filter: String,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RedmineInfo {
    pub id: u64,
    pub url: String,
    pub title: String,
    pub status: String,
    pub priority: String,
    pub owner: String,
    pub error: String,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReportError {
    pub scope: String,
    pub message: String,
}

fn read_config() -> Config {
    let region = env::var("CRASHSIGHT_REGION").unwrap_or_else(|_| "cn".to_string());
    let base_url = env::var("CRASHSIGHT_BASE_URL").unwrap_or_else(|_| {
        if region.eq_ignore_ascii_case("sg") {
            "https://crashsight.wetest.net".to_string()
        } else {
            "https://crashsight.qq.com".to_string()
        }
    });
    let branch_filters =
        parse_branch_filters(&env::var("CRASHSIGHT_BRANCH_FILTERS").unwrap_or_default());
    let app_ids = HashMap::from([
        (
            "pc".to_string(),
            env::var("CRASHSIGHT_APP_ID_PC").unwrap_or_default(),
        ),
        (
            "android".to_string(),
            env::var("CRASHSIGHT_APP_ID_ANDROID").unwrap_or_default(),
        ),
        (
            "ios".to_string(),
            env::var("CRASHSIGHT_APP_ID_IOS").unwrap_or_default(),
        ),
    ]);

    Config {
        base_url: trim_slash(&base_url),
        redmine_base_url: trim_slash(
            &env::var("REDMINE_BASE_URL")
                .or_else(|_| env::var("CRASH_AI_REDMINE_BASE_URL"))
                .unwrap_or_else(|_| "http://soc-redmine.wd.com".to_string()),
        ),
        local_user_id: env::var("CRASHSIGHT_LOCAL_USER_ID").unwrap_or_default(),
        openapi_key: env::var("CRASHSIGHT_OPENAPI_KEY").unwrap_or_default(),
        app_ids,
        branch_filters,
        crash_concurrency: read_usize_env("CRASH_AI_MAX_CONCURRENCY", 12, 1, 64),
        redmine_concurrency: read_usize_env("CRASH_AI_REDMINE_CONCURRENCY", 8, 1, 32),
        redmine_api_key: env::var("REDMINE_API_KEY").unwrap_or_default(),
    }
}

pub async fn generate_report(input: ReportInput) -> Result<Report> {
    let total_start = Instant::now();
    let config = read_config();
    if config.local_user_id.is_empty() || config.openapi_key.is_empty() {
        return Err(anyhow!(
            "Missing CrashSight credentials: CRASHSIGHT_LOCAL_USER_ID, CRASHSIGHT_OPENAPI_KEY"
        ));
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .context("create reqwest client")?;
    let date_range = normalize_date_range(&input)?;
    let platforms = resolve_platforms(&input, &config)?;
    let version_filters = resolve_version_filters(&input, &config);
    let page_size = input.page_size.unwrap_or(500).clamp(1, 500);
    let max_pages = input.max_pages.unwrap_or(100).clamp(1, 1000);

    let scan_start = Instant::now();
    let combos: Vec<_> = platforms
        .iter()
        .flat_map(|platform| {
            version_filters
                .iter()
                .map(move |version| (platform.clone(), version.clone()))
        })
        .collect();

    let scan_results = stream::iter(combos)
        .map(|(platform, version_filter)| {
            let client = client.clone();
            let config = config.clone();
            let date_range = date_range.clone();
            async move {
                scan_combo(
                    &client,
                    &config,
                    &date_range,
                    &platform,
                    &version_filter,
                    page_size,
                    max_pages,
                )
                .await
            }
        })
        .buffer_unordered(config.crash_concurrency)
        .collect::<Vec<_>>()
        .await;

    let mut rows = Vec::new();
    let mut errors = Vec::new();
    let mut api_row_count = 0usize;
    let mut filtered_out_by_date = 0usize;
    let mut pages_scanned = 0usize;
    let mut possibly_truncated = false;

    for result in scan_results {
        match result {
            Ok(mut partial) => {
                api_row_count += partial.api_row_count;
                filtered_out_by_date += partial.filtered_out_by_date;
                pages_scanned += partial.pages_scanned;
                possibly_truncated |= partial.possibly_truncated;
                rows.append(&mut partial.rows);
            }
            Err(error) => errors.push(ReportError {
                scope: "CrashSight".to_string(),
                message: error.to_string(),
            }),
        }
    }
    rows = merge_rows(rows);
    let issue_detail_errors = enrich_issue_details(&client, &config, &mut rows).await;
    errors.extend(issue_detail_errors);
    rows.sort_by(|a, b| {
        b.total_affected_devices
            .cmp(&a.total_affected_devices)
            .then(b.total_crash_num.cmp(&a.total_crash_num))
    });
    for (idx, row) in rows.iter_mut().enumerate() {
        row.id = idx + 1;
    }
    let crash_ms = scan_start.elapsed().as_millis();

    let redmine_start = Instant::now();
    let redmine = if input.include_redmine.unwrap_or(true) {
        enrich_redmine(&client, &config, &mut rows).await
    } else {
        Vec::new()
    };
    let redmine_ms = redmine_start.elapsed().as_millis();

    let duplicate_stats = detect_potential_duplicates(&rows);
    let summary = ReportSummary {
        total_issues: rows.len(),
        raw_issue_count: rows.len(),
        api_row_count,
        filtered_out_by_date,
        potential_duplicate_issue_count: duplicate_stats.0,
        cross_version_duplicate_issue_count: duplicate_stats.1,
        pages_scanned,
        possibly_truncated,
    };

    let render_start = Instant::now();
    let mut report = Report {
        markdown: String::new(),
        summary,
        rows,
        redmine,
        errors,
        timing_ms: TimingMs {
            total: 0,
            crash_sight: crash_ms,
            redmine: redmine_ms,
            render: 0,
        },
    };
    let top_n = input.top_n.unwrap_or(10).clamp(1, 1000);
    report.markdown = render_markdown_report_with_top_n(
        &report,
        &format!("{} 至 {}", date_range.start_time, date_range.end_time),
        &platforms
            .iter()
            .map(|p| p.label)
            .collect::<Vec<_>>()
            .join(", "),
        &version_filters.join(", "),
        top_n,
    );
    report.timing_ms.render = render_start.elapsed().as_millis();
    report.timing_ms.total = total_start.elapsed().as_millis();
    Ok(report)
}

#[derive(Debug, Default)]
struct PartialScan {
    rows: Vec<IssueRow>,
    api_row_count: usize,
    filtered_out_by_date: usize,
    pages_scanned: usize,
    possibly_truncated: bool,
}

#[derive(Debug, Default)]
struct CrashAggregate {
    platform: String,
    platform_id: u32,
    app_id: String,
    issue_id: String,
    application_version: String,
    version_filters: BTreeSet<String>,
    crash_ids: BTreeSet<String>,
    device_ids: BTreeSet<String>,
    crash_count: u64,
    first_ms: i64,
    latest_ms: i64,
    first_seen_time: String,
    latest_upload_time: String,
}

async fn scan_combo(
    client: &Client,
    config: &Config,
    date_range: &DateRange,
    platform: &Platform,
    version_filter: &str,
    page_size: usize,
    max_pages: usize,
) -> Result<PartialScan> {
    let mut partial = PartialScan::default();
    let mut seen_page_keys = BTreeSet::new();
    let mut merged_rows = BTreeMap::<String, IssueRow>::new();

    for page in 1..=max_pages {
        let offset = (page - 1) * page_size;
        let body = json!({
            "appId": platform.app_id,
            "platformId": platform.id,
            "pid": platform.id.to_string(),
            "exceptionTypeList": "Crash,Native,ExtensionCrash",
            "rows": page_size,
            "page": page,
            "pageNum": page,
            "offset": offset,
            "start": offset,
            "version": version_filter,
            "startDate": date_range.start_date,
            "endDate": date_range.end_date,
        });
        let data =
            post_crashsight(client, config, "/uniform/openapi/queryCrashList", &body).await?;
        let raw_records = crash_records_from_response(&data);
        if raw_records.is_empty() {
            break;
        }
        let raw_count = raw_records.len();
        let page_key = raw_records
            .iter()
            .map(|record| {
                text_at(
                    record,
                    &["crashId", "crashHash", "issueId", "detailId", "expUid"],
                )
            })
            .collect::<Vec<_>>()
            .join("|");
        if !seen_page_keys.insert(page_key) {
            break;
        }
        partial.api_row_count += raw_count;
        partial.pages_scanned += 1;
        let page_partial =
            aggregate_crash_list_page(platform, version_filter, &data, date_range, config);
        partial.filtered_out_by_date += page_partial.filtered_out_by_date;
        merge_issue_rows(&mut merged_rows, page_partial.rows);
        if raw_count < page_size {
            break;
        }
        if let Some(num_found) = data.get("numFound").and_then(Value::as_u64) {
            if offset + raw_count >= num_found as usize {
                break;
            }
        }
        if page == max_pages {
            partial.possibly_truncated = true;
        }
    }
    partial.rows = merged_rows.into_values().collect();
    Ok(partial)
}

async fn post_crashsight(
    client: &Client,
    config: &Config,
    api_path: &str,
    body: &Value,
) -> Result<Value> {
    let url = signed_url(config, api_path)?;
    let response = client
        .post(url)
        .header("Accept", "application/json")
        .json(body)
        .send()
        .await
        .with_context(|| format!("CrashSight request failed: {api_path}"))?;
    let status = response.status();
    let parsed: Value = response.json().await.context("parse CrashSight JSON")?;
    if !status.is_success() {
        return Err(anyhow!("CrashSight HTTP {status}: {parsed}"));
    }
    unwrap_crashsight(parsed, api_path)
}

fn aggregate_crash_list_page(
    platform: &Platform,
    version_filter: &str,
    data: &Value,
    date_range: &DateRange,
    config: &Config,
) -> PartialScan {
    let mut partial = PartialScan::default();
    let fallback_issue_ids = issue_ids_from_response(data);
    let mut aggregates = BTreeMap::<String, CrashAggregate>::new();
    for record in crash_records_from_response(data) {
        let mut issue_id = text_at(
            &record,
            &[
                "issueId",
                "issueHash",
                "crashHash",
                "crashMap.issueId",
                "detailMap.issueId",
                "esMap.issueId",
            ],
        );
        if issue_id.is_empty() && fallback_issue_ids.len() == 1 {
            issue_id = fallback_issue_ids[0].clone();
        }
        if issue_id.is_empty() {
            continue;
        }

        let upload_ms = timestamp_from_crash_record(&record);
        if upload_ms != 0 && (upload_ms < date_range.start_ms || upload_ms > date_range.end_ms) {
            partial.filtered_out_by_date += 1;
            continue;
        }

        let application_version = first_non_empty(&[
            text_at(
                &record,
                &[
                    "productVersion",
                    "crashVersion",
                    "version",
                    "appVersion",
                    "crashMap.productVersion",
                    "detailMap.productVersion",
                    "esMap.productVersion",
                    "esMap.version",
                ],
            ),
            version_filter.to_string(),
        ]);
        let key = format!(
            "{}|{}|{}",
            platform.id,
            issue_id,
            application_version.to_ascii_lowercase()
        );
        let entry = aggregates.entry(key).or_insert_with(|| CrashAggregate {
            platform: platform.label.to_string(),
            platform_id: platform.id,
            app_id: platform.app_id.clone(),
            issue_id: issue_id.clone(),
            application_version: application_version.clone(),
            ..Default::default()
        });
        entry.version_filters.insert(version_filter.to_string());
        entry.crash_count += 1;
        let crash_id = text_at(
            &record,
            &["crashId", "crashHash", "detailId", "expUid", "bucketPath"],
        );
        if !crash_id.is_empty() {
            entry.crash_ids.insert(crash_id);
        }
        let device_id = text_at(
            &record,
            &[
                "deviceId",
                "imei",
                "expUid",
                "userId",
                "crashMap.deviceId",
                "detailMap.deviceId",
                "esMap.deviceId",
            ],
        );
        if !device_id.is_empty() {
            entry.device_ids.insert(device_id);
        }
        if upload_ms != 0 {
            if entry.first_ms == 0 || upload_ms < entry.first_ms {
                entry.first_ms = upload_ms;
                entry.first_seen_time = first_non_empty(&[
                    text_at(
                        &record,
                        &[
                            "crashUploadTime",
                            "uploadTime",
                            "crashTime",
                            "firstUploadTime",
                            "esMap.crashUploadTime",
                        ],
                    ),
                    format_timestamp_ms(upload_ms),
                ]);
            }
            if upload_ms > entry.latest_ms {
                entry.latest_ms = upload_ms;
                entry.latest_upload_time = first_non_empty(&[
                    text_at(
                        &record,
                        &[
                            "crashUploadTime",
                            "uploadTime",
                            "crashTime",
                            "latestUploadTime",
                            "esMap.crashUploadTime",
                        ],
                    ),
                    format_timestamp_ms(upload_ms),
                ]);
            }
        }
    }

    partial.api_row_count = crash_records_from_response(data).len();
    partial.rows = aggregates
        .into_values()
        .map(|aggregate| aggregate.into_issue_row(config))
        .collect();
    partial
}

impl CrashAggregate {
    fn into_issue_row(self, config: &Config) -> IssueRow {
        let total_crash_num = if self.crash_ids.is_empty() {
            self.crash_count
        } else {
            self.crash_ids.len() as u64
        };
        let total_affected_devices = if self.device_ids.is_empty() {
            total_crash_num
        } else {
            self.device_ids.len() as u64
        };
        IssueRow {
            id: 0,
            platform: self.platform,
            issue_id: self.issue_id.clone(),
            crash_sight_link: format!(
                "{}/crash-reporting/crashes/{}/{}?pid={}",
                trim_slash(&config.base_url),
                self.app_id,
                self.issue_id,
                self.platform_id
            ),
            total_crash_num,
            total_affected_devices,
            first_seen_time: self.first_seen_time,
            latest_upload_time: self.latest_upload_time,
            first_seen_version: self.application_version.clone(),
            application_version: self.application_version,
            continued_version_count: 1,
            tags: Vec::new(),
            redmine_refs: Vec::new(),
            redmine_links: Vec::new(),
            redmine_status: String::new(),
            redmine_owner: String::new(),
            judgement: String::new(),
            next_step: String::new(),
            version_filter: self
                .version_filters
                .into_iter()
                .collect::<Vec<_>>()
                .join(", "),
        }
    }
}

fn crash_records_from_response(data: &Value) -> Vec<Value> {
    for path in [
        "crashDatas",
        "items",
        "crashList",
        "crashDataList",
        "records",
    ] {
        if let Some(value) = value_at(data, path) {
            if let Some(array) = value.as_array() {
                return array
                    .iter()
                    .filter(|item| !item.is_null())
                    .cloned()
                    .collect();
            }
            if let Some(object) = value.as_object() {
                return object
                    .values()
                    .filter(|item| !item.is_null())
                    .cloned()
                    .collect();
            }
        }
    }
    data.get("issueList")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter(|item| item.is_object())
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

fn issue_ids_from_response(data: &Value) -> Vec<String> {
    data.get("issueList")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    if let Some(text) = item.as_str() {
                        return Some(text.trim().to_string());
                    }
                    if item.is_object() {
                        return Some(text_at(item, &["issueId", "issueHash", "crashHash"]));
                    }
                    None
                })
                .filter(|text| !text.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn merge_rows(rows: Vec<IssueRow>) -> Vec<IssueRow> {
    let mut merged = BTreeMap::new();
    merge_issue_rows(&mut merged, rows);
    merged.into_values().collect()
}

fn merge_issue_rows(target: &mut BTreeMap<String, IssueRow>, rows: Vec<IssueRow>) {
    for row in rows {
        let key = row_merge_key(&row);
        if let Some(existing) = target.get_mut(&key) {
            merge_issue_row(existing, row);
        } else {
            target.insert(key, row);
        }
    }
}

fn row_merge_key(row: &IssueRow) -> String {
    format!(
        "{}|{}|{}",
        row.platform,
        row.issue_id,
        row.application_version.to_ascii_lowercase()
    )
}

fn merge_issue_row(target: &mut IssueRow, incoming: IssueRow) {
    target.total_crash_num += incoming.total_crash_num;
    target.total_affected_devices += incoming.total_affected_devices;
    target.first_seen_time = earliest_time(&target.first_seen_time, &incoming.first_seen_time);
    target.latest_upload_time =
        latest_time(&target.latest_upload_time, &incoming.latest_upload_time);
    target.version_filter =
        join_unique_strings(&[&target.version_filter, &incoming.version_filter]);
    target.tags = union_strings(&target.tags, &incoming.tags);
    target.redmine_refs = union_u64(&target.redmine_refs, &incoming.redmine_refs);
    target.redmine_links = union_strings(&target.redmine_links, &incoming.redmine_links);
}

async fn enrich_issue_details(
    client: &Client,
    config: &Config,
    rows: &mut [IssueRow],
) -> Vec<ReportError> {
    let requests = rows
        .iter()
        .filter_map(|row| {
            let platform = platform_from_label(&row.platform)?;
            let app_id = config.app_ids.get(platform.0).cloned().unwrap_or_default();
            if app_id.is_empty() || row.issue_id.is_empty() {
                return None;
            }
            Some((
                row.platform.clone(),
                platform.1,
                app_id,
                row.issue_id.clone(),
            ))
        })
        .collect::<BTreeSet<_>>();

    let details = stream::iter(requests)
        .map(|(platform_label, platform_id, app_id, issue_id)| {
            let client = client.clone();
            let config = config.clone();
            async move {
                fetch_issue_detail(
                    &client,
                    &config,
                    platform_label,
                    platform_id,
                    app_id,
                    issue_id,
                )
                .await
            }
        })
        .buffer_unordered(config.crash_concurrency)
        .collect::<Vec<_>>()
        .await;

    let mut detail_map = HashMap::new();
    let mut errors = Vec::new();
    for result in details {
        match result {
            Ok((platform_label, issue_id, detail)) => {
                detail_map.insert(format!("{platform_label}|{issue_id}"), detail);
            }
            Err(error) => errors.push(error),
        }
    }

    for row in rows {
        if let Some(detail) = detail_map.get(&format!("{}|{}", row.platform, row.issue_id)) {
            apply_issue_detail(row, detail, config);
        }
    }
    errors
}

async fn fetch_issue_detail(
    client: &Client,
    config: &Config,
    platform_label: String,
    platform_id: u32,
    app_id: String,
    issue_id: String,
) -> std::result::Result<(String, String, Value), ReportError> {
    let detail = post_crashsight(
        client,
        config,
        "/uniform/openapi/issueInfo",
        &json!({
            "appId": app_id,
            "platformId": platform_id.to_string(),
            "issueId": issue_id,
        }),
    )
    .await
    .map_err(|error| ReportError {
        scope: format!("CrashSight issueInfo {platform_label}/{issue_id}"),
        message: error.to_string(),
    })?;
    Ok((platform_label, issue_id, detail))
}

fn apply_issue_detail(row: &mut IssueRow, detail: &Value, config: &Config) {
    let Some((platform_key, platform_id)) = platform_from_label(&row.platform) else {
        return;
    };
    let app_id = config
        .app_ids
        .get(platform_key)
        .cloned()
        .unwrap_or_default();
    let detail_row = normalize_issue_row(
        &row.platform,
        platform_id,
        &app_id,
        &row.version_filter,
        detail,
        &config.base_url,
        &config.redmine_base_url,
    );
    if detail_row.total_crash_num > 0 {
        row.total_crash_num = detail_row.total_crash_num;
    }
    if detail_row.total_affected_devices > 0 {
        row.total_affected_devices = detail_row.total_affected_devices;
    }
    if !detail_row.first_seen_time.is_empty() {
        row.first_seen_time = detail_row.first_seen_time;
    }
    if !detail_row.latest_upload_time.is_empty() {
        row.latest_upload_time = detail_row.latest_upload_time;
    }
    if !detail_row.first_seen_version.is_empty() {
        row.first_seen_version = detail_row.first_seen_version;
    }
    if !detail_row.application_version.is_empty()
        && detail_row.application_version != "CrashSight未提供"
        && (row.application_version.is_empty()
            || row.application_version == row.version_filter
            || row.application_version.contains('*'))
    {
        row.application_version = detail_row.application_version;
    }
    if detail_row.continued_version_count > 0 {
        row.continued_version_count = detail_row.continued_version_count;
    }
    row.tags = union_strings(&row.tags, &detail_row.tags);
    row.redmine_refs = union_u64(&row.redmine_refs, &detail_row.redmine_refs);
    row.redmine_links = union_strings(&row.redmine_links, &detail_row.redmine_links);
}

async fn enrich_redmine(
    client: &Client,
    config: &Config,
    rows: &mut [IssueRow],
) -> Vec<RedmineInfo> {
    let mut refs = BTreeSet::new();
    for row in rows.iter() {
        for id in &row.redmine_refs {
            refs.insert(*id);
        }
    }
    if refs.is_empty() {
        return Vec::new();
    }
    if config.redmine_api_key.is_empty() {
        for row in rows {
            if !row.redmine_refs.is_empty() {
                row.redmine_status = "Redmine 未验证".to_string();
                row.redmine_owner = "Redmine 未验证".to_string();
            }
        }
        return refs
            .into_iter()
            .map(|id| RedmineInfo {
                id,
                url: format!("{}/issues/{}", config.redmine_base_url, id),
                title: "Redmine 未验证".to_string(),
                status: "Redmine 未验证".to_string(),
                priority: "Redmine 未验证".to_string(),
                owner: "Redmine 未验证".to_string(),
                error: "REDMINE_API_KEY not configured".to_string(),
            })
            .collect();
    }

    let infos = stream::iter(refs.into_iter())
        .map(|id| {
            let client = client.clone();
            let config = config.clone();
            async move { fetch_redmine_issue(&client, &config, id).await }
        })
        .buffer_unordered(config.redmine_concurrency)
        .collect::<Vec<_>>()
        .await;
    let mut map = HashMap::new();
    let mut out = Vec::new();
    for info in infos {
        let info = info.unwrap_or_else(|(id, error)| RedmineInfo {
            id,
            url: format!("{}/issues/{}", config.redmine_base_url, id),
            title: "Redmine 未验证".to_string(),
            status: "Redmine 未验证".to_string(),
            priority: "Redmine 未验证".to_string(),
            owner: "Redmine 未验证".to_string(),
            error,
        });
        map.insert(info.id, info.clone());
        out.push(info);
    }
    for row in rows {
        let infos = row
            .redmine_refs
            .iter()
            .filter_map(|id| map.get(id))
            .collect::<Vec<_>>();
        if !infos.is_empty() {
            row.redmine_status = infos
                .iter()
                .map(|info| format!("#{} {}", info.id, info.status))
                .collect::<Vec<_>>()
                .join(", ");
            row.redmine_owner = infos
                .iter()
                .map(|info| info.owner.clone())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<_>>()
                .join(", ");
        }
    }
    out
}

async fn fetch_redmine_issue(
    client: &Client,
    config: &Config,
    id: u64,
) -> std::result::Result<RedmineInfo, (u64, String)> {
    let url = format!(
        "{}/issues/{}.json?include=journals,attachments,changesets,relations",
        config.redmine_base_url, id
    );
    let response = client
        .get(&url)
        .header("X-Redmine-API-Key", &config.redmine_api_key)
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| (id, e.to_string()))?;
    let status = response.status();
    let parsed: Value = response.json().await.map_err(|e| (id, e.to_string()))?;
    if !status.is_success() {
        return Err((id, format!("Redmine HTTP {status}")));
    }
    let issue = parsed.get("issue").unwrap_or(&parsed);
    let title = issue
        .get("subject")
        .and_then(Value::as_str)
        .unwrap_or("未提供")
        .to_string();
    let status = issue
        .pointer("/status/name")
        .and_then(Value::as_str)
        .unwrap_or("未知")
        .to_string();
    let priority = issue
        .pointer("/priority/name")
        .and_then(Value::as_str)
        .unwrap_or("未提供")
        .to_string();
    let owner = extract_owner(issue);
    Ok(RedmineInfo {
        id,
        url: format!("{}/issues/{}", config.redmine_base_url, id),
        title,
        status,
        priority,
        owner,
        error: String::new(),
    })
}

pub fn normalize_issue_row(
    platform: &str,
    platform_id: u32,
    app_id: &str,
    version_filter: &str,
    issue: &Value,
    base_url: &str,
    redmine_base_url: &str,
) -> IssueRow {
    let issue_id = text_at(issue, &["issueId", "esMap.issueId"]);
    let tags = normalize_tags(issue);
    let redmine_refs = extract_redmine_refs(&tags);
    let redmine_links = redmine_refs
        .iter()
        .map(|id| format!("[#{}]({}/issues/{})", id, trim_slash(redmine_base_url), id))
        .collect::<Vec<_>>();
    let total_crash_num = metric_at(
        issue,
        &[
            "totalCrashNum",
            "totalExceptionNum",
            "totalCrashCount",
            "totalCount",
            "totalUploadCount",
            "totalIssueCrashNum",
            "crashTotal",
            "crashCount",
            "esMap.totalCrashNum",
            "esMap.totalExceptionNum",
            "esMap.totalCrashCount",
            "esMap.totalCount",
            "crashNum",
            "exceptionNum",
            "count",
            "uploadCount",
            "esMap.crashNum",
            "esMap.exceptionNum",
            "esMap.count",
            "esMap.uploadCount",
        ],
    );
    let total_affected_devices = metric_at(
        issue,
        &[
            "totalAffectedUsersOrDevices",
            "totalDeviceCount",
            "totalImeiCount",
            "totalUserCount",
            "affectedDeviceCount",
            "affectedDevices",
            "deviceCount",
            "imeiCount",
            "esDeviceCount",
            "esMap.totalAffectedUsersOrDevices",
            "esMap.totalDeviceCount",
            "esMap.totalImeiCount",
            "esMap.totalUserCount",
            "esMap.affectedDeviceCount",
            "esMap.affectedDevices",
            "esMap.deviceCount",
            "esMap.imeiCount",
            "esMap.esDeviceCount",
            "userCount",
            "esMap.userCount",
        ],
    );
    let application_version = text_at(
        issue,
        &[
            "appVersion",
            "applicationVersion",
            "productVersion",
            "versionName",
            "buildVersion",
            "esMap.appVersion",
            "esMap.applicationVersion",
            "esMap.productVersion",
            "esMap.versionName",
            "lastMatchedReport.crashMap.productVersion",
            "issueVersion",
            "version",
            "esMap.issueVersion",
        ],
    );
    IssueRow {
        id: 0,
        platform: platform.to_string(),
        issue_id: issue_id.clone(),
        crash_sight_link: format!(
            "{}/crash-reporting/crashes/{}/{}?pid={}",
            trim_slash(base_url),
            app_id,
            issue_id,
            platform_id
        ),
        total_crash_num,
        total_affected_devices,
        first_seen_time: text_at(
            issue,
            &["firstUploadTime", "firstCrashTime", "esMap.firstUploadTime"],
        ),
        latest_upload_time: text_at(
            issue,
            &[
                "lastestUploadTime",
                "latestUploadTime",
                "lastUploadTime",
                "firstUploadTime",
                "esMap.latestUploadTime",
            ],
        ),
        first_seen_version: text_at(
            issue,
            &[
                "firstCrashVersion",
                "firstVersion",
                "esMap.firstCrashVersion",
                "issueVersion",
                "version",
            ],
        ),
        application_version: if application_version.is_empty() {
            "CrashSight未提供".to_string()
        } else {
            application_version
        },
        continued_version_count: issue
            .get("issueVersions")
            .and_then(Value::as_array)
            .map(|versions| versions.len())
            .unwrap_or(0),
        tags,
        redmine_refs,
        redmine_links,
        redmine_status: String::new(),
        redmine_owner: String::new(),
        judgement: String::new(),
        next_step: String::new(),
        version_filter: version_filter.to_string(),
    }
}

pub fn render_markdown_report(
    report: &Report,
    range_label: &str,
    platforms: &str,
    versions: &str,
) -> String {
    render_markdown_report_with_top_n(report, range_label, platforms, versions, 10)
}

fn render_markdown_report_with_top_n(
    report: &Report,
    range_label: &str,
    platforms: &str,
    versions: &str,
    _top_n: usize,
) -> String {
    let mut md = String::new();
    md.push_str(&format!("# CrashAI 巡检报告 - {}\n\n", range_label));
    md.push_str("## 巡检范围\n\n");
    md.push_str("| 项目 | 值 |\n| --- | --- |\n");
    md.push_str(&format!("| 时间范围 | {} |\n", range_label));
    md.push_str(&format!("| 平台 | {} |\n", platforms));
    md.push_str(&format!("| 版本过滤 | {} |\n", versions));
    md.push_str(&format!(
        "| CrashSight 返回 Issue 数 | {} |\n",
        report.summary.total_issues
    ));
    md.push_str(&format!(
        "| 潜在重复命中 | {}（仅提示，不扣减） |\n",
        report.summary.potential_duplicate_issue_count
    ));
    md.push_str(&format!(
        "| 分页扫描页数 | {} |\n",
        report.summary.pages_scanned
    ));
    md.push_str(&format!(
        "| 可能截断 | {} |\n\n",
        if report.summary.possibly_truncated {
            "是"
        } else {
            "否"
        }
    ));

    md.push_str("## Crash 总览\n\n");
    md.push_str(&format!(
        "- 总崩溃次数累计：{}\n- 影响设备累计：{}\n- Redmine 关联数：{}\n\n",
        report
            .rows
            .iter()
            .map(|row| row.total_crash_num)
            .sum::<u64>(),
        report
            .rows
            .iter()
            .map(|row| row.total_affected_devices)
            .sum::<u64>(),
        report
            .rows
            .iter()
            .flat_map(|row| row.redmine_refs.iter())
            .collect::<BTreeSet<_>>()
            .len()
    ));

    md.push_str("## Crash 明细表\n\n");
    md.push_str("| ID | 平台 | CrashSight | 崩溃次数(总计) | 影响设备(总计) | 最早出现时间 | 最近出现时间 | 首次版本 | 应用版本 | 延续版本数 | 标签 | Redmine | Redmine状态 | 程序负责人 |\n");
    md.push_str(
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n",
    );
    for row in &report.rows {
        md.push_str(&format!(
            "| {} | {} | [CrashSight]({}) | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} |\n",
            row.id,
            escape_cell(&row.platform),
            row.crash_sight_link,
            row.total_crash_num,
            row.total_affected_devices,
            escape_cell(&row.first_seen_time),
            escape_cell(&row.latest_upload_time),
            escape_cell(&row.first_seen_version),
            escape_cell(&row.application_version),
            row.continued_version_count,
            escape_cell(&row.tags.join(", ")),
            if row.redmine_links.is_empty() {
                "-".to_string()
            } else {
                row.redmine_links.join(", ")
            },
            escape_cell(if row.redmine_status.is_empty() {
                "-"
            } else {
                &row.redmine_status
            }),
            escape_cell(if row.redmine_owner.is_empty() {
                "-"
            } else {
                &row.redmine_owner
            }),
        ));
    }
    md.push_str("\n## Redmine 关联状态表\n\n");
    md.push_str("| Redmine | 标题 | 状态 | 优先级 | 负责人 |\n| --- | --- | --- | --- | --- |\n");
    if report.redmine.is_empty() {
        md.push_str("| - | - | Redmine 未验证 | - | - |\n");
    } else {
        for info in &report.redmine {
            md.push_str(&format!(
                "| [#{}]({}) | {} | {} | {} | {} |\n",
                info.id,
                info.url,
                escape_cell(&info.title),
                escape_cell(&info.status),
                escape_cell(&info.priority),
                escape_cell(&info.owner)
            ));
        }
    }
    md.push_str("\n> 以上为 MCP 采集事实区。`判断`、`下一步`、`版本延续/解决判断`、`需程序排查清单` 和 `未验证项/阻塞项` 由 Agent 基于结构化 rows/redmine/errors 继续分析生成。\n");
    md
}

pub fn extract_redmine_refs(tags: &[String]) -> Vec<u64> {
    let mut refs = Vec::new();
    for tag in tags {
        let mut current = String::new();
        for ch in tag.chars() {
            if ch.is_ascii_digit() {
                current.push(ch);
            } else {
                push_ref(&mut refs, &current);
                current.clear();
            }
        }
        push_ref(&mut refs, &current);
    }
    refs
}

fn push_ref(refs: &mut Vec<u64>, digits: &str) {
    if (5..=8).contains(&digits.len()) {
        if let Ok(value) = digits.parse::<u64>() {
            if !refs.contains(&value) {
                refs.push(value);
            }
        }
    }
}

fn normalize_tags(issue: &Value) -> Vec<String> {
    let value = issue
        .get("tagInfoList")
        .or_else(|| issue.get("tags"))
        .or_else(|| issue.get("tag"))
        .or_else(|| issue.get("issueTag"))
        .or_else(|| issue.pointer("/esMap/tag"));
    let Some(value) = value else {
        return Vec::new();
    };
    let list = if let Some(list) = value.as_array() {
        list.clone()
    } else {
        vec![value.clone()]
    };
    list.iter()
        .filter_map(|tag| {
            if let Some(text) = tag.as_str() {
                return Some(text.trim().to_string());
            }
            if let Some(obj) = tag.as_object() {
                for key in [
                    "name",
                    "label",
                    "value",
                    "text",
                    "tagName",
                    "displayName",
                    "title",
                    "content",
                    "url",
                    "href",
                ] {
                    if let Some(text) = obj.get(key).and_then(Value::as_str) {
                        return Some(text.trim().to_string());
                    }
                }
            }
            None
        })
        .filter(|text| !text.is_empty())
        .collect()
}

fn detect_potential_duplicates(rows: &[IssueRow]) -> (usize, usize) {
    let mut groups: HashMap<String, Vec<&IssueRow>> = HashMap::new();
    for row in rows {
        groups
            .entry(format!("{}:{}", row.platform, row.issue_id))
            .or_default()
            .push(row);
    }
    let mut potential = 0;
    let mut cross_version = 0;
    for group in groups.values() {
        if group.len() <= 1 {
            continue;
        }
        potential += group.len() - 1;
        let filters = group
            .iter()
            .map(|row| row.version_filter.as_str())
            .collect::<BTreeSet<_>>();
        if filters.len() > 1 {
            cross_version += group.len() - 1;
        }
    }
    (potential, cross_version)
}

fn parse_branch_filters(raw: &str) -> BTreeMap<String, String> {
    let mut filters = BTreeMap::from([
        ("trunk".to_string(), "*trunk*".to_string()),
        ("weekly".to_string(), "*weekly*".to_string()),
    ]);
    if raw.trim().is_empty() {
        return filters;
    }
    if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(raw) {
        for (key, value) in map {
            if let Some(pattern) = value.as_str() {
                filters.insert(key, pattern.to_string());
            }
        }
    }
    filters
}

fn resolve_version_filters(input: &ReportInput, config: &Config) -> Vec<String> {
    let raw = input
        .version_filters
        .as_ref()
        .filter(|filters| !filters.is_empty())
        .cloned()
        .or_else(|| {
            input
                .branches
                .as_ref()
                .filter(|branches| !branches.is_empty())
                .cloned()
        })
        .unwrap_or_else(|| config.branch_filters.keys().cloned().collect());
    let mut out = Vec::new();
    for item in raw {
        let value = config.branch_filters.get(&item).cloned().unwrap_or(item);
        if !out.contains(&value) {
            out.push(value);
        }
    }
    out
}

fn resolve_platforms(input: &ReportInput, config: &Config) -> Result<Vec<Platform>> {
    let raw = input
        .platforms
        .clone()
        .or_else(|| input.platform.clone().map(|p| vec![p]))
        .unwrap_or_else(|| vec![json!("pc"), json!("android"), json!("ios")]);
    let mut platforms = Vec::new();
    let mut seen = BTreeSet::new();
    for item in raw {
        let text = item
            .as_str()
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_else(|| item.to_string().trim_matches('"').to_ascii_lowercase());
        let (key, id, label) = match text.as_str() {
            "10" | "pc" | "windows" => ("pc", 10, "PC"),
            "1" | "android" => ("android", 1, "Android"),
            "2" | "ios" | "iphone" => ("ios", 2, "iOS"),
            other => return Err(anyhow!("Unsupported platform: {other}")),
        };
        if !seen.insert(id) {
            continue;
        }
        let app_id = config.app_ids.get(key).cloned().unwrap_or_default();
        if app_id.is_empty() {
            return Err(anyhow!(
                "Missing appId for {label}: configure CRASHSIGHT_APP_ID_{}",
                key.to_ascii_uppercase()
            ));
        }
        platforms.push(Platform { id, label, app_id });
    }
    Ok(platforms)
}

fn normalize_date_range(input: &ReportInput) -> Result<DateRange> {
    let start_raw = input
        .start_time
        .as_deref()
        .or(input.start_date.as_deref())
        .or(input.date.as_deref())
        .ok_or_else(|| anyhow!("date, startDate/endDate, or startTime/endTime is required"))?;
    let end_raw = input
        .end_time
        .as_deref()
        .or(input.end_date.as_deref())
        .or(input.date.as_deref())
        .unwrap_or(start_raw);
    let start = parse_datetime(start_raw, false)?;
    let end = parse_datetime(end_raw, true)?;
    if start > end {
        return Err(anyhow!("start time must be earlier than end time"));
    }
    Ok(DateRange {
        start_date: start.format("%Y%m%d").to_string(),
        end_date: end.format("%Y%m%d").to_string(),
        start_time: start.format("%Y-%m-%d %H:%M:%S").to_string(),
        end_time: end.format("%Y-%m-%d %H:%M:%S").to_string(),
        start_ms: start.timestamp_millis(),
        end_ms: end.timestamp_millis(),
    })
}

fn parse_datetime(raw: &str, end_of_day: bool) -> Result<DateTime<Local>> {
    let text = raw.trim().replace('T', " ").replace('/', "-");
    for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y%m%d%H%M%S"] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(&text, fmt) {
            return Local
                .from_local_datetime(&naive)
                .single()
                .ok_or_else(|| anyhow!("invalid local time"));
        }
    }
    let date = if let Ok(date) = NaiveDate::parse_from_str(&text, "%Y-%m-%d") {
        date
    } else {
        NaiveDate::parse_from_str(&text, "%Y%m%d")
            .context("date/time must be YYYYMMDD, YYYY-MM-DD, or YYYY-MM-DD HH:mm:ss")?
    };
    let time = if end_of_day {
        chrono::NaiveTime::from_hms_opt(23, 59, 59).unwrap()
    } else {
        chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap()
    };
    Local
        .from_local_datetime(&NaiveDateTime::new(date, time))
        .single()
        .ok_or_else(|| anyhow!("invalid local time"))
}

fn timestamp_from_crash_record(record: &Value) -> i64 {
    for path in [
        "crashUploadTimestamp",
        "uploadTimestamp",
        "crashTimeTimestamp",
        "crashMap.crashUploadTimestamp",
        "detailMap.crashUploadTimestamp",
        "esMap.crashUploadTimestamp",
    ] {
        if let Some(value) = value_at(record, path) {
            let ts = timestamp_from_value(value);
            if ts != 0 {
                return ts;
            }
        }
    }
    for path in [
        "crashUploadTime",
        "uploadTime",
        "crashTime",
        "crashMap.crashUploadTime",
        "detailMap.crashUploadTime",
        "esMap.crashUploadTime",
    ] {
        if let Some(value) = value_at(record, path) {
            let ts = timestamp_from_value(value);
            if ts != 0 {
                return ts;
            }
        }
    }
    0
}

fn timestamp_from_value(value: &Value) -> i64 {
    if let Some(ts) = value
        .as_i64()
        .or_else(|| value.as_str().and_then(|s| s.trim().parse().ok()))
    {
        return if ts < 10_000_000_000 { ts * 1000 } else { ts };
    }
    if let Some(text) = value.as_str() {
        if let Ok(dt) = parse_datetime(text, false) {
            return dt.timestamp_millis();
        }
    }
    0
}

fn format_timestamp_ms(ms: i64) -> String {
    Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_default()
}

fn earliest_time(left: &str, right: &str) -> String {
    if left.is_empty() {
        return right.to_string();
    }
    if right.is_empty() {
        return left.to_string();
    }
    let left_ms = parse_datetime(left, false)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(i64::MAX);
    let right_ms = parse_datetime(right, false)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(i64::MAX);
    if right_ms < left_ms {
        right.to_string()
    } else {
        left.to_string()
    }
}

fn latest_time(left: &str, right: &str) -> String {
    if left.is_empty() {
        return right.to_string();
    }
    if right.is_empty() {
        return left.to_string();
    }
    let left_ms = parse_datetime(left, false)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0);
    let right_ms = parse_datetime(right, false)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0);
    if right_ms > left_ms {
        right.to_string()
    } else {
        left.to_string()
    }
}

fn first_non_empty(values: &[String]) -> String {
    values
        .iter()
        .find(|value| !value.trim().is_empty())
        .cloned()
        .unwrap_or_default()
}

fn join_unique_strings(values: &[&str]) -> String {
    values
        .iter()
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>()
        .join(", ")
}

fn union_strings(left: &[String], right: &[String]) -> Vec<String> {
    left.iter()
        .chain(right.iter())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(ToString::to_string)
        .collect()
}

fn union_u64(left: &[u64], right: &[u64]) -> Vec<u64> {
    left.iter()
        .chain(right.iter())
        .copied()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn platform_from_label(label: &str) -> Option<(&'static str, u32)> {
    match label.to_ascii_lowercase().as_str() {
        "pc" | "windows" => Some(("pc", 10)),
        "android" => Some(("android", 1)),
        "ios" | "iphone" => Some(("ios", 2)),
        _ => None,
    }
}

fn signed_url(config: &Config, api_path: &str) -> Result<String> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let message = format!("{}_{}", config.local_user_id, ts);
    let mut mac = HmacSha256::new_from_slice(config.openapi_key.as_bytes())?;
    mac.update(message.as_bytes());
    let hex = mac
        .finalize()
        .into_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let secret = base64::engine::general_purpose::STANDARD.encode(hex);
    Ok(format!(
        "{}{}?userSecret={}&localUserId={}&t={}",
        config.base_url,
        api_path,
        urlencoding::encode(&secret),
        urlencoding::encode(&config.local_user_id),
        ts
    ))
}

fn unwrap_crashsight(parsed: Value, api_path: &str) -> Result<Value> {
    if let Some(ret) = parsed.get("ret") {
        if let Some(code) = ret.get("code").and_then(Value::as_i64) {
            if code != 200 {
                return Err(anyhow!("CrashSight API code {code} for {api_path}"));
            }
        }
        return Ok(ret.get("data").cloned().unwrap_or_else(|| ret.clone()));
    }
    if let Some(code) = parsed.get("code").and_then(Value::as_i64) {
        if code != 200 {
            return Err(anyhow!("CrashSight API code {code} for {api_path}"));
        }
    }
    Ok(parsed.get("data").cloned().unwrap_or(parsed))
}

fn extract_owner(issue: &Value) -> String {
    if let Some(fields) = issue.get("custom_fields").and_then(Value::as_array) {
        for field in fields {
            let name = field.get("name").and_then(Value::as_str).unwrap_or("");
            if ["程序", "开发", "负责人", "owner"].iter().any(|needle| {
                name.to_ascii_lowercase()
                    .contains(&needle.to_ascii_lowercase())
            }) {
                if let Some(value) = human_redmine_field_value(field) {
                    return value;
                }
            }
        }
    }
    assigned_to_display(issue).unwrap_or_else(|| "未指定".to_string())
}

fn human_redmine_field_value(field: &Value) -> Option<String> {
    for key in ["display_value", "displayValue", "label", "text", "value"] {
        if let Some(value) = field.get(key) {
            if let Some(text) = human_redmine_value(value) {
                return Some(text);
            }
        }
    }
    None
}

fn human_redmine_value(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return if is_human_owner_value(text) {
            Some(text.trim().to_string())
        } else {
            None
        };
    }
    if let Some(array) = value.as_array() {
        let values = array
            .iter()
            .filter_map(human_redmine_value)
            .collect::<Vec<_>>();
        if !values.is_empty() {
            return Some(values.join(", "));
        }
    }
    if let Some(object) = value.as_object() {
        for key in [
            "display_value",
            "displayValue",
            "name",
            "login",
            "label",
            "value",
        ] {
            if let Some(text) = object.get(key).and_then(human_redmine_value) {
                return Some(text);
            }
        }
    }
    None
}

fn is_human_owner_value(value: &str) -> bool {
    let text = value.trim();
    if text.is_empty() {
        return false;
    }
    let compact = text.replace([',', ';', ' '], "");
    !compact.is_empty() && !compact.chars().all(|ch| ch.is_ascii_digit())
}

fn assigned_to_display(issue: &Value) -> Option<String> {
    let assigned = issue.get("assigned_to")?;
    let name = assigned.get("name").and_then(Value::as_str)?.trim();
    if name.is_empty() {
        return None;
    }
    let login = assigned
        .get("login")
        .or_else(|| assigned.get("login_name"))
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    if !login.is_empty() && !name.contains(login) {
        Some(format!("{name}({login})"))
    } else {
        Some(name.to_string())
    }
}

fn metric_at(value: &Value, paths: &[&str]) -> u64 {
    for path in paths {
        if let Some(value) = value_at(value, path) {
            if let Some(num) = value.as_u64() {
                return num;
            }
            if let Some(text) = value.as_str() {
                if let Ok(num) = text.replace(',', "").parse::<u64>() {
                    return num;
                }
            }
        }
    }
    0
}

fn text_at(value: &Value, paths: &[&str]) -> String {
    for path in paths {
        if let Some(value) = value_at(value, path) {
            if let Some(text) = value.as_str() {
                if !text.trim().is_empty() {
                    return text.trim().to_string();
                }
            }
            if value.is_number() {
                return value.to_string();
            }
        }
    }
    String::new()
}

fn value_at<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for part in path.split('.') {
        current = current.get(part)?;
    }
    Some(current)
}

fn read_usize_env(name: &str, default: usize, min: usize, max: usize) -> usize {
    env::var(name)
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(default)
        .clamp(min, max)
}

fn trim_slash(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

fn escape_cell(value: &str) -> String {
    value.replace('|', "\\|").replace('\n', " ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> Config {
        Config {
            base_url: "https://crashsight.qq.com".to_string(),
            redmine_base_url: "http://soc-redmine.wd.com".to_string(),
            local_user_id: "local-user".to_string(),
            openapi_key: "openapi-key".to_string(),
            app_ids: HashMap::new(),
            branch_filters: BTreeMap::from([
                ("trunk".to_string(), "*trunk*".to_string()),
                ("weekly".to_string(), "*weekly*".to_string()),
            ]),
            crash_concurrency: 12,
            redmine_concurrency: 8,
            redmine_api_key: String::new(),
        }
    }

    #[test]
    fn empty_version_filters_fall_back_to_configured_branch_filters() {
        let input = ReportInput {
            version_filters: Some(Vec::new()),
            branches: Some(Vec::new()),
            ..Default::default()
        };

        let filters = resolve_version_filters(&input, &test_config());

        assert_eq!(filters, vec!["*trunk*".to_string(), "*weekly*".to_string()]);
    }

    #[test]
    fn crash_list_records_are_aggregated_by_issue_platform_and_application_version() {
        let config = test_config();
        let platform = Platform {
            id: 10,
            label: "PC",
            app_id: "pc-app".to_string(),
        };
        let date_range = DateRange {
            start_date: "20260511".to_string(),
            end_date: "20260511".to_string(),
            start_time: "2026-05-11 00:00:00".to_string(),
            end_time: "2026-05-11 23:59:59".to_string(),
            start_ms: parse_datetime("2026-05-11 00:00:00", false)
                .unwrap()
                .timestamp_millis(),
            end_ms: parse_datetime("2026-05-11 23:59:59", false)
                .unwrap()
                .timestamp_millis(),
        };
        let data = json!({
            "numFound": 3,
            "crashDatas": {
                "c1": {
                    "issueId": "ISSUE-1",
                    "crashId": "c1",
                    "deviceId": "device-a",
                    "productVersion": "Soc_PC_trunk_1",
                    "crashUploadTime": "2026-05-11 10:00:00"
                },
                "c2": {
                    "issueId": "ISSUE-1",
                    "crashId": "c2",
                    "deviceId": "device-a",
                    "productVersion": "Soc_PC_trunk_1",
                    "crashUploadTime": "2026-05-11 10:05:00"
                },
                "c3": {
                    "issueId": "ISSUE-1",
                    "crashId": "c3",
                    "deviceId": "device-b",
                    "productVersion": "Soc_PC_weekly_1",
                    "crashUploadTime": "2026-05-11 11:00:00"
                }
            }
        });

        let partial = aggregate_crash_list_page(&platform, "*trunk*", &data, &date_range, &config);

        assert_eq!(partial.api_row_count, 3);
        assert_eq!(partial.rows.len(), 2);
        let trunk = partial
            .rows
            .iter()
            .find(|row| row.application_version == "Soc_PC_trunk_1")
            .unwrap();
        assert_eq!(trunk.total_crash_num, 2);
        assert_eq!(trunk.total_affected_devices, 1);
        assert_eq!(trunk.latest_upload_time, "2026-05-11 10:05:00");
    }

    #[test]
    fn extract_owner_ignores_numeric_custom_field_ids_and_uses_assignee_login() {
        let issue = json!({
            "custom_fields": [
                { "name": "程序负责人", "value": "68" }
            ],
            "assigned_to": {
                "name": "唐宇",
                "login": "ty"
            }
        });

        assert_eq!(extract_owner(&issue), "唐宇(ty)");
    }
}
