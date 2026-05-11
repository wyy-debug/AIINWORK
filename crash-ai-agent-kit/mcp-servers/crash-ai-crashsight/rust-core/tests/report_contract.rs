use crash_ai_core::{
    IssueRow, RedmineInfo, Report, ReportSummary, extract_redmine_refs, normalize_issue_row,
    render_markdown_report,
};
use serde_json::json;

#[test]
fn extracts_redmine_refs_from_tags_and_urls() {
    let refs = extract_redmine_refs(&[
        "redmine:116320".to_string(),
        "http://soc-redmine.wd.com/issues/116204".to_string(),
        "#101769".to_string(),
    ]);

    assert_eq!(refs, vec![116320, 116204, 101769]);
}

#[test]
fn normalizes_application_version_and_total_device_count() {
    let row = normalize_issue_row(
        "PC",
        10,
        "pc-app",
        "*trunk*",
        &json!({
            "issueId": "ISSUE-1",
            "crashNum": 144,
            "userCount": 2,
            "deviceCount": 28,
            "appVersion": "Soc_PC_1.2.3",
            "firstUploadTime": "2026-05-08 11:00:00",
            "latestUploadTime": "2026-05-09 12:00:00",
            "tag": ["http://soc-redmine.wd.com/issues/116204"]
        }),
        "https://crashsight.qq.com",
        "http://soc-redmine.wd.com",
    );

    assert_eq!(row.issue_id, "ISSUE-1");
    assert_eq!(row.total_crash_num, 144);
    assert_eq!(row.total_affected_devices, 28);
    assert_eq!(row.application_version, "Soc_PC_1.2.3");
    assert_eq!(row.redmine_refs, vec![116204]);
    assert_eq!(
        row.crash_sight_link,
        "https://crashsight.qq.com/crash-reporting/crashes/pc-app/ISSUE-1?pid=10"
    );
}

#[test]
fn renders_fixed_markdown_table_without_period_columns_or_grouping() {
    let report = Report {
        markdown: String::new(),
        summary: ReportSummary {
            total_issues: 1,
            raw_issue_count: 1,
            api_row_count: 1,
            filtered_out_by_date: 0,
            potential_duplicate_issue_count: 0,
            cross_version_duplicate_issue_count: 0,
            pages_scanned: 1,
            possibly_truncated: false,
        },
        rows: vec![IssueRow {
            id: 1,
            platform: "PC".into(),
            issue_id: "ISSUE-1".into(),
            crash_sight_link:
                "https://crashsight.qq.com/crash-reporting/crashes/pc-app/ISSUE-1?pid=10".into(),
            total_crash_num: 144,
            total_affected_devices: 28,
            first_seen_time: "2026-05-08 11:00:00".into(),
            latest_upload_time: "2026-05-09 12:00:00".into(),
            first_seen_version: "1.0.0".into(),
            application_version: "Soc_PC_1.2.3".into(),
            continued_version_count: 0,
            tags: vec!["redmine:116204".into()],
            redmine_refs: vec![116204],
            redmine_links: vec!["[#116204](http://soc-redmine.wd.com/issues/116204)".into()],
            redmine_status: "已关闭".into(),
            redmine_owner: "张三".into(),
            judgement: "无法确认".into(),
            next_step: "查看 CrashSight 样本".into(),
            version_filter: "*trunk*".into(),
        }],
        redmine: vec![RedmineInfo {
            id: 116204,
            url: "http://soc-redmine.wd.com/issues/116204".into(),
            title: "Fix startup crash".into(),
            status: "Closed".into(),
            priority: "High".into(),
            owner: "engineer-a".into(),
            error: "Redmine HTTP 500".into(),
        }],
        errors: vec![],
        timing_ms: Default::default(),
    };

    let markdown = render_markdown_report(&report, "2026-05-09", "PC", "*trunk*");

    assert!(markdown.contains("| ID | 平台 | CrashSight | 崩溃次数(总计) | 影响设备(总计) | 最早出现时间 | 最近出现时间 | 首次版本 | 应用版本 | 延续版本数 | 标签 | Redmine | Redmine状态 | 程序负责人 |"));
    assert!(!markdown.contains("| 判断 | 下一步 |"));
    assert!(markdown.contains("| Redmine | 标题 | 状态 | 优先级 | 负责人 |"));
    assert!(!markdown.contains("| Redmine | 状态 | 程序负责人 | 错误 |"));
    assert!(!markdown.contains("Redmine HTTP 500"));
    assert!(!markdown.contains("## 版本延续/解决判断"));
    assert!(!markdown.contains("## 需程序排查清单"));
    assert!(!markdown.contains("## 单 Crash 深度分析入口"));
    assert!(!markdown.contains("## 未验证项/阻塞项"));
    assert!(!markdown.contains("原始命中行数"));
    assert!(!markdown.contains("API 原始行数"));
    assert!(!markdown.contains("被日期过滤掉"));
    assert!(!markdown.contains("崩溃次数(本期)"));
    assert!(!markdown.contains("影响设备(本期)"));
    assert!(!markdown.contains("| Platform |"));
    assert!(!markdown.contains("Total Crashes"));
    assert!(markdown.contains(
        "[CrashSight](https://crashsight.qq.com/crash-reporting/crashes/pc-app/ISSUE-1?pid=10)"
    ));
    assert!(markdown.contains("[#116204](http://soc-redmine.wd.com/issues/116204)"));
    assert!(!markdown.contains("其余"));
}
