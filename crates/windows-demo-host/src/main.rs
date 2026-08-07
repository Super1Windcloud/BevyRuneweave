#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

#[cfg(not(target_os = "windows"))]
fn main() {
    eprintln!("the demo host is only available on Windows");
}

#[cfg(target_os = "windows")]
mod windows_host {
    use compress_tools::{Ownership, uncompress_archive};
    use libloading::{Library, Symbol};
    use std::{
        ffi::{CString, OsStr, c_char, c_int},
        fs,
        io::{BufReader, Cursor},
        os::windows::ffi::OsStrExt,
        path::{Path, PathBuf},
        ptr,
        sync::{Mutex, OnceLock},
        thread,
    };
    use windows_sys::Win32::{
        Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM},
        Graphics::Gdi::{DEFAULT_GUI_FONT, GetStockObject, HGDIOBJ},
        System::LibraryLoader::GetModuleHandleW,
        UI::WindowsAndMessaging::*,
    };

    const ID_URL: i32 = 1001;
    const ID_START: i32 = 1002;
    const WM_DOWNLOAD_DONE: u32 = WM_APP + 1;
    const DLL_RELATIVE_PATH: &str =
        "dist/runtimes/windows/typescript/x86_64-pc-windows-msvc/lib/bevy_runeweave.dll";

    #[derive(Default)]
    struct State {
        status: Option<Result<(), String>>,
        launch: bool,
    }

    static STATE: OnceLock<Mutex<State>> = OnceLock::new();

    fn wide(value: impl AsRef<OsStr>) -> Vec<u16> {
        value.as_ref().encode_wide().chain(Some(0)).collect()
    }

    fn repo_root() -> Result<PathBuf, String> {
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        for ancestor in executable.ancestors() {
            if ancestor.join(DLL_RELATIVE_PATH).is_file() {
                return Ok(ancestor.to_path_buf());
            }
        }
        let current = std::env::current_dir().map_err(|error| error.to_string())?;
        if current.join(DLL_RELATIVE_PATH).is_file() {
            Ok(current)
        } else {
            Err(format!("找不到运行时 DLL: {DLL_RELATIVE_PATH}"))
        }
    }

    fn download_and_install(url: &str) -> Result<(), String> {
        let root = repo_root()?;
        let response = reqwest::blocking::Client::builder()
            .user_agent("BevyRuneWeave-Windows-Demo/0.1")
            .build()
            .map_err(|error| error.to_string())?
            .get(url)
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .map_err(|error| format!("下载失败: {error}"))?;
        let bytes = response
            .bytes()
            .map_err(|error| format!("读取下载内容失败: {error}"))?;
        let staging = tempfile::Builder::new()
            .prefix("bevy-runeweave-assets-")
            .tempdir_in(&root)
            .map_err(|error| format!("创建临时目录失败: {error}"))?;

        let mut archive = BufReader::new(Cursor::new(bytes));
        uncompress_archive(&mut archive, staging.path(), Ownership::Ignore)
            .map_err(|error| format!("libarchive 解压失败: {error}"))?;
        let script =
            find_script(staging.path())?.ok_or_else(|| "资源包中缺少 shooter.js".to_owned())?;
        let package_root = script
            .parent()
            .ok_or_else(|| "无效的 shooter.js 路径".to_owned())?;
        install_tree(package_root, &root.join("assets"))
    }

    fn find_script(directory: &Path) -> Result<Option<PathBuf>, String> {
        for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
            let path = entry.map_err(|error| error.to_string())?.path();
            if path.is_dir() {
                if let Some(found) = find_script(&path)? {
                    return Ok(Some(found));
                }
            } else if path.file_name() == Some(OsStr::new("shooter.js")) {
                return Ok(Some(path));
            }
        }
        Ok(None)
    }

    fn install_tree(source: &Path, destination: &Path) -> Result<(), String> {
        fs::create_dir_all(destination).map_err(|error| error.to_string())?;
        for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let target = destination.join(entry.file_name());
            if entry.path().is_dir() {
                install_tree(&entry.path(), &target)?;
            } else {
                fs::copy(entry.path(), target).map_err(|error| error.to_string())?;
            }
        }
        Ok(())
    }

    unsafe fn set_text(window: HWND, text: &str) {
        let text = wide(text);
        unsafe { SetWindowTextW(window, text.as_ptr()) };
    }

    unsafe extern "system" fn window_proc(
        window: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match message {
            WM_CREATE => {
                let font = unsafe { GetStockObject(DEFAULT_GUI_FONT) };
                let edit = unsafe {
                    CreateWindowExW(
                        WS_EX_CLIENTEDGE,
                        wide("EDIT").as_ptr(),
                        ptr::null(),
                        WS_CHILD | WS_VISIBLE | WS_TABSTOP | ES_AUTOHSCROLL,
                        24,
                        28,
                        512,
                        32,
                        window,
                        ID_URL as isize as _,
                        0 as HINSTANCE,
                        ptr::null(),
                    )
                };
                unsafe { SendMessageW(edit, WM_SETFONT, font as HGDIOBJ as usize, 1) };
                unsafe { SendMessageW(edit, EM_SETCUEBANNER, 0, wide("资源 URL").as_ptr() as _) };
                let button = unsafe {
                    CreateWindowExW(
                        0,
                        wide("BUTTON").as_ptr(),
                        wide("开始游戏").as_ptr(),
                        WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_DEFPUSHBUTTON,
                        396,
                        78,
                        140,
                        36,
                        window,
                        ID_START as isize as _,
                        0 as HINSTANCE,
                        ptr::null(),
                    )
                };
                unsafe { SendMessageW(button, WM_SETFONT, font as HGDIOBJ as usize, 1) };
                0
            }
            WM_COMMAND if (wparam & 0xffff) as i32 == ID_START => {
                let edit = unsafe { GetDlgItem(window, ID_URL) };
                let length = unsafe { GetWindowTextLengthW(edit) };
                let mut buffer = vec![0_u16; length as usize + 1];
                unsafe { GetWindowTextW(edit, buffer.as_mut_ptr(), buffer.len() as i32) };
                let url = String::from_utf16_lossy(&buffer[..length as usize]);
                if url.trim().is_empty() {
                    unsafe {
                        MessageBoxW(
                            window,
                            wide("请输入资源 URL").as_ptr(),
                            wide("提示").as_ptr(),
                            MB_OK | MB_ICONINFORMATION,
                        )
                    };
                    return 0;
                }
                unsafe { EnableWindow(edit, 0) };
                let button = unsafe { GetDlgItem(window, ID_START) };
                unsafe { EnableWindow(button, 0) };
                unsafe { set_text(button, "下载中...") };
                let target = window as isize;
                thread::spawn(move || {
                    let result = download_and_install(url.trim());
                    if let Ok(mut state) = STATE.get_or_init(Default::default).lock() {
                        state.status = Some(result);
                    }
                    unsafe { PostMessageW(target as HWND, WM_DOWNLOAD_DONE, 0, 0) };
                });
                0
            }
            WM_DOWNLOAD_DONE => {
                let result = STATE
                    .get_or_init(Default::default)
                    .lock()
                    .ok()
                    .and_then(|mut state| state.status.take());
                match result {
                    Some(Ok(())) => {
                        if let Ok(mut state) = STATE.get_or_init(Default::default).lock() {
                            state.launch = true;
                        }
                        unsafe { DestroyWindow(window) };
                    }
                    Some(Err(error)) => {
                        unsafe {
                            MessageBoxW(
                                window,
                                wide(&error).as_ptr(),
                                wide("启动失败").as_ptr(),
                                MB_OK | MB_ICONERROR,
                            )
                        };
                        let edit = unsafe { GetDlgItem(window, ID_URL) };
                        let button = unsafe { GetDlgItem(window, ID_START) };
                        unsafe { EnableWindow(edit, 1) };
                        unsafe { EnableWindow(button, 1) };
                        unsafe { set_text(button, "开始游戏") };
                    }
                    None => {}
                }
                0
            }
            WM_DESTROY => {
                unsafe { PostQuitMessage(0) };
                0
            }
            _ => unsafe { DefWindowProcW(window, message, wparam, lparam) },
        }
    }

    fn show_launcher() -> Result<bool, String> {
        let instance = unsafe { GetModuleHandleW(ptr::null()) };
        if instance.is_null() {
            return Err("无法取得程序模块句柄".to_owned());
        }
        let class_name = wide("BevyRuneWeaveDemoHost");
        let class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: instance,
            hCursor: unsafe { LoadCursorW(ptr::null_mut(), IDC_ARROW) },
            hbrBackground: (COLOR_WINDOW + 1) as _,
            lpszClassName: class_name.as_ptr(),
            ..unsafe { std::mem::zeroed() }
        };
        if unsafe { RegisterClassW(&class) } == 0 {
            return Err("注册窗口失败".to_owned());
        }
        let window = unsafe {
            CreateWindowExW(
                0,
                class_name.as_ptr(),
                wide("Bevy RuneWeave Demo").as_ptr(),
                WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
                CW_USEDEFAULT,
                CW_USEDEFAULT,
                576,
                180,
                ptr::null_mut(),
                ptr::null_mut(),
                instance,
                ptr::null(),
            )
        };
        if window.is_null() {
            return Err("创建窗口失败".to_owned());
        }
        unsafe { ShowWindow(window, SW_SHOW) };
        let mut message = unsafe { std::mem::zeroed::<MSG>() };
        while unsafe { GetMessageW(&mut message, ptr::null_mut(), 0, 0) } > 0 {
            unsafe {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
        Ok(STATE
            .get_or_init(Default::default)
            .lock()
            .map(|state| state.launch)
            .unwrap_or(false))
    }

    fn run_game() -> Result<(), String> {
        let root = repo_root()?;
        std::env::set_current_dir(&root).map_err(|error| error.to_string())?;
        let library = unsafe { Library::new(root.join(DLL_RELATIVE_PATH)) }
            .map_err(|error| format!("加载运行时 DLL 失败: {error}"))?;
        type Run = unsafe extern "C" fn(*const c_char) -> c_int;
        let run: Symbol<'_, Run> = unsafe { library.get(b"game_runtime_run\0") }
            .map_err(|error| format!("查找运行时入口失败: {error}"))?;
        let script = CString::new("shooter.js").map_err(|error| error.to_string())?;
        let code = unsafe { run(script.as_ptr()) };
        if code == 0 {
            Ok(())
        } else {
            Err(format!("游戏运行时返回错误码 {code}"))
        }
    }

    pub fn main() {
        let result = show_launcher().and_then(|launch| if launch { run_game() } else { Ok(()) });
        if let Err(error) = result {
            unsafe {
                MessageBoxW(
                    ptr::null_mut(),
                    wide(error).as_ptr(),
                    wide("Bevy RuneWeave").as_ptr(),
                    MB_OK | MB_ICONERROR,
                )
            };
        }
    }
}

#[cfg(target_os = "windows")]
fn main() {
    windows_host::main();
}
