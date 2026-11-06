use chrono::Local;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn save_drink_history_csv(
    app_handle: tauri::AppHandle,
    content: String,
) -> Result<Option<String>, String> {
    let file_name = format!("shui-drink-history-{}.csv", Local::now().format("%Y%m%d"));
    let selected_path = app_handle
        .dialog()
        .file()
        .set_title("导出饮水记录")
        .set_file_name(file_name)
        .add_filter("CSV", &["csv"])
        .blocking_save_file();

    let Some(file_path) = selected_path else {
        return Ok(None);
    };
    let path = file_path.into_path().map_err(|error| error.to_string())?;

    std::fs::write(&path, content).map_err(|error| format!("写入导出文件失败: {error}"))?;

    Ok(Some(path.to_string_lossy().into_owned()))
}
