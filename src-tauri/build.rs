use std::fs;

fn main() {
    // 本地 GA4 凭据放在 src-tauri/ga4.local.json（已加入 .gitignore）。
    // 文件存在时注入编译期环境变量，desktop_analytics 用 option_env! 读取；
    // 文件不存在时保持外部 SHUI_GA4_* 环境变量或 no-op。
    println!("cargo:rerun-if-changed=ga4.local.json");
    if let Ok(raw) = fs::read_to_string("ga4.local.json") {
        if let Ok(config) = serde_json::from_str::<serde_json::Value>(&raw) {
            for (key, env_key) in [
                ("measurement_id", "SHUI_GA4_MEASUREMENT_ID"),
                ("api_secret", "SHUI_GA4_API_SECRET"),
            ] {
                if let Some(value) = config.get(key).and_then(|value| value.as_str()) {
                    let value = value.trim();
                    if !value.is_empty() {
                        println!("cargo:rustc-env={env_key}={value}");
                    }
                }
            }
        }
    }
    tauri_build::build()
}
