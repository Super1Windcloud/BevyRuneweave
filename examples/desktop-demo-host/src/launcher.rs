//! Native launcher presentation. Package installation and runtime hosting stay in `main`.

use crate::i18n::text;

use super::{
    InstalledGame, Language, LauncherApp, ReleaseAsset, format_size, open_resource_directory,
};
use gpui_kit::{
    App, AppContext, Bounds, Context, Entity, FontWeight, IntoElement, ParentElement, Render,
    SharedString, Styled, Subscription, Task, TitlebarOptions, Window, WindowBounds, WindowOptions,
    assets::{AllAssets, IconName},
    component::{
        ActiveTheme, Disableable, Icon, Sizable, WindowExt,
        button::{Button, ButtonCustomVariant, ButtonVariant, ButtonVariants},
        input::{Input, InputEvent, InputState},
        scroll::ScrollableElement,
        spinner::Spinner,
        theme::{Theme, ThemeMode},
    },
    div,
    prelude::*,
    px, rgb, size,
};
use std::time::Duration;

const INK: u32 = 0x252923;
const MUTED: u32 = 0x797D75;
const PAPER: u32 = 0xF6F7F3;
const LINE: u32 = 0xE4E7DF;
const ACCENT: u32 = 0xC45331;
const SIDEBAR: u32 = 0x252C27;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Page {
    Library,
    Downloads,
}

struct Launcher {
    state: LauncherApp,
    page: Page,
    url_input: Entity<InputState>,
    _input_subscription: Subscription,
    _appearance_subscription: Subscription,
    _updates: Task<()>,
}

impl Launcher {
    fn new(state: LauncherApp, window: &mut Window, cx: &mut Context<Self>) -> Self {
        gpui_kit::component::set_locale(if crate::i18n::is_chinese() {
            "zh-CN"
        } else {
            "en"
        });
        configure_theme(window.appearance().into(), cx);
        let appearance_subscription = cx.observe_window_appearance(window, |_, window, cx| {
            configure_theme(window.appearance().into(), cx);
            cx.notify();
        });
        let url_input =
            cx.new(|cx| InputState::new(window, cx).placeholder("https://example.com/game.zip"));
        let subscription = cx.subscribe_in(&url_input, window, |this, _, event, _, cx| {
            if matches!(event, InputEvent::PressEnter { .. }) {
                this.install_url(cx);
            }
        });
        let updates = Self::watch_pending(cx);
        Self {
            state,
            page: Page::Library,
            url_input,
            _input_subscription: subscription,
            _appearance_subscription: appearance_subscription,
            _updates: updates,
        }
    }

    // Poll only while a worker is active; idle windows do not wake a timer.
    fn watch_pending(cx: &mut Context<Self>) -> Task<()> {
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(Duration::from_millis(100))
                    .await;
                let pending = this.update(cx, |this, cx| {
                    let download_changed = this.state.poll_download();
                    let release_changed = this.state.poll_remote_assets();
                    let cleanup_changed = this.state.poll_cleanup();
                    if download_changed || release_changed || cleanup_changed {
                        cx.notify();
                    }
                    this.state.result.is_some()
                        || this.state.remote_assets_result.is_some()
                        || this.state.cleanup_result.is_some()
                });
                if !matches!(pending, Ok(true)) {
                    break;
                }
            }
        })
    }

    fn install_url(&mut self, cx: &mut Context<Self>) {
        self.state.url = self.url_input.read(cx).value().to_string();
        self.state.start_download();
        self._updates = Self::watch_pending(cx);
        cx.notify();
    }

    fn install_asset(&mut self, asset: &ReleaseAsset, cx: &mut Context<Self>) {
        self.state.url = asset.browser_download_url.clone();
        self.state.start_download();
        self._updates = Self::watch_pending(cx);
        cx.notify();
    }

    fn confirm_cleanup(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.state.resources_busy() {
            return;
        }
        let view = cx.weak_entity();
        window.open_alert_dialog(cx, move |dialog, _, _| {
            let view = view.clone();
            dialog
                .confirm()
                .title(text("Clear local game resources?"))
                .description(text("Close running games first. This removes downloaded game assets and the current game selection. Logs, bundled demo resources, and other files outside asset folders are kept. You can download games again from Discover."))
                .ok_text(text("Clear resources"))
                .ok_variant(ButtonVariant::Danger)
                .cancel_text(text("Cancel"))
                .on_ok(move |_, _, cx| {
                    view.update(cx, |this, cx| {
                        if this.state.resources_busy() {
                            return false;
                        }
                        this.state.start_cleanup();
                        this._updates = Self::watch_pending(cx);
                        cx.notify();
                        true
                    }).unwrap_or(false)
                })
        });
    }

    fn navigation(&self, compact: bool, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .flex_shrink_0()
            .h_full()
            .w(px(if compact { 72. } else { 208. }))
            .p_4()
            .bg(tone(SIDEBAR, 0x141B16, cx))
            .text_color(rgb(0xE9EDE5))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_3()
                    .pt_3()
                    .pb_8()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_center()
                            .size(px(40.))
                            .rounded(px(12.))
                            .bg(tone(ACCENT, 0xE58A62, cx))
                            .child(
                                Icon::new(IconName::Layers)
                                    .size(px(22.))
                                    .text_color(rgb(0xFFFFFF)),
                            ),
                    )
                    .when(!compact, |view| {
                        view.child(
                            div()
                                .flex()
                                .flex_col()
                                .gap_1()
                                .child(div().font_weight(FontWeight::SEMIBOLD).child("RuneWeave"))
                                .child(
                                    div()
                                        .text_size(px(10.))
                                        .text_color(rgb(0xACB5A8))
                                        .child(text("DESKTOP LAUNCHER")),
                                ),
                        )
                    }),
            )
            .child(self.nav_button(
                Page::Library,
                IconName::LayoutGrid,
                "My library",
                compact,
                cx,
            ))
            .child(div().h_2())
            .child(self.nav_button(Page::Downloads, IconName::Download, "Discover", compact, cx))
            .child(div().flex_1())
            .child(
                Button::new("open-resources")
                    .custom(sidebar_button_style(false, cx))
                    .icon(IconName::FolderOpen)
                    .when(!compact, |button| button.label(text("Resource folder")))
                    .text_color(rgb(0xCFD6C9))
                    .tooltip(text("Open installed resources"))
                    .on_click(cx.listener(|this, _, _, cx| {
                        if let Err(error) = open_resource_directory() {
                            this.state.error = Some(error);
                            cx.notify();
                        }
                    })),
            )
            .child(
                Button::new("clear-resources")
                    .custom(
                        sidebar_button_style(false, cx)
                            .foreground(tone(0xE6AA96, 0xE8A993, cx).into()),
                    )
                    .icon(IconName::Trash)
                    .when(!compact, |button| button.label(text("Clear resources")))
                    .tooltip(text("Clear downloaded game resources"))
                    .disabled(self.state.resources_busy())
                    .on_click(cx.listener(|this, _, window, cx| this.confirm_cleanup(window, cx))),
            )
            .when(!compact, |view| {
                view.child(
                    div()
                        .mt_5()
                        .pt_4()
                        .border_t_1()
                        .border_color(rgb(0x3A433B))
                        .text_size(px(11.))
                        .text_color(rgb(0x9EA996))
                        .child(text("A little world, ready to play.")),
                )
            })
    }

    fn nav_button(
        &self,
        page: Page,
        icon: IconName,
        label: &'static str,
        compact: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let selected = self.page == page;
        Button::new(label)
            .custom(sidebar_button_style(selected, cx))
            .icon(icon)
            .h(px(42.))
            .w_full()
            .when(!compact, |button| button.label(text(label)))
            .toggled(selected)
            .tooltip(text(label))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.page = page;
                cx.notify();
            }))
    }

    fn header(&self, compact: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let (eyebrow, title, subtitle) = match self.page {
            Page::Library => (
                "YOUR SPACE TO PLAY",
                "My library",
                "Small worlds. Endless possibilities.",
            ),
            Page::Downloads => (
                "SOMETHING NEW AWAITS",
                "Discover",
                "Find your next world, or bring your own.",
            ),
        };
        div()
            .flex()
            .justify_between()
            .items_center()
            .gap_3()
            .pb_6()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .min_w_0()
                    .child(kicker(text(eyebrow), cx))
                    .child(
                        div()
                            .text_size(px(30.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(text(title)),
                    )
                    .when(!compact, |view| view.child(secondary(text(subtitle), cx))),
            )
            .child(
                Button::new("refresh")
                    .outline()
                    .icon(IconName::RefreshCw)
                    .when(!compact, |button| button.label(text("Refresh")))
                    .disabled(
                        self.state.resources_busy()
                            || (self.page == Page::Downloads
                                && self.state.remote_assets_result.is_some()),
                    )
                    .tooltip(text("Refresh this page"))
                    .on_click(cx.listener(|this, _, _, cx| {
                        match this.page {
                            Page::Library => {
                                this.state.error = this.state.refresh_installed_games().err();
                            }
                            Page::Downloads => {
                                this.state.refresh_remote_assets();
                                this._updates = Self::watch_pending(cx);
                            }
                        }
                        cx.notify();
                    })),
            )
    }

    fn library(&self, compact: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let featured = self
            .state
            .installed_games
            .iter()
            .find(|game| self.state.active_project.as_deref() == Some(&game.project))
            .or_else(|| self.state.installed_games.first());
        let mut body = div().flex().flex_col().gap_6();
        if let Some(game) = featured {
            let project = game.project.clone();
            body = body.child(
                div()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .p_6()
                    .rounded(px(18.))
                    .bg(tone(0xE9EEDD, 0x2B382B, cx))
                    .border_1()
                    .border_color(tone(0xDDE5D0, 0x43513B, cx))
                    .child(kicker(text("PICK UP & PLAY"), cx))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_4()
                            .when(!compact, |view| {
                                view.child(game_mark(game.language, 64., cx))
                            })
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap_2()
                                    .min_w_0()
                                    .flex_1()
                                    .child(
                                        div()
                                            .text_size(px(25.))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .truncate()
                                            .child(game.name.clone()),
                                    )
                                    .child(secondary(
                                        host_format!(
                                            "{}  /  Version {}",
                                            game.language.label(),
                                            game.version
                                        ),
                                        cx,
                                    )),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .gap_3()
                            .child(secondary(
                                text("Your next adventure is one click away."),
                                cx,
                            ))
                            .child(
                                Button::new("play-featured")
                                    .primary()
                                    .icon(IconName::Play)
                                    .label(text("Play now"))
                                    .h(px(42.))
                                    .disabled(self.state.resources_busy())
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.state.start_installed_game(&project);
                                        cx.notify();
                                    })),
                            ),
                    ),
            );
        }
        body = body.child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap_3()
                .child(
                    div()
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(text("Installed games")),
                )
                .child(secondary(
                    text("{count} in your library")
                        .replace("{count}", &self.state.installed_games.len().to_string()),
                    cx,
                )),
        );
        if self.state.installed_games.is_empty() {
            body = body.child(
                card(cx)
                    .items_center()
                    .justify_center()
                    .gap_4()
                    .py_8()
                    .child(
                        Icon::new(IconName::Package)
                            .size(px(38.))
                            .text_color(rgb(0x7D8C6F)),
                    )
                    .child(
                        div()
                            .text_size(px(20.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(text("Make room for a little adventure")),
                    )
                    .child(secondary(
                        text("Install a game from Discover to get started."),
                        cx,
                    ))
                    .child(
                        Button::new("browse-games")
                            .primary()
                            .label(text("Explore games"))
                            .icon(IconName::ArrowRight)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.page = Page::Downloads;
                                cx.notify();
                            })),
                    ),
            );
        } else {
            body = body.child(
                div().flex().flex_col().gap_3().children(
                    self.state
                        .installed_games
                        .iter()
                        .map(|game| self.game_card(game, compact, cx)),
                ),
            );
        }
        body
    }

    fn game_card(
        &self,
        game: &InstalledGame,
        compact: bool,
        cx: &mut Context<Self>,
    ) -> gpui_kit::Div {
        let project = game.project.clone();
        let active = self.state.active_project.as_deref() == Some(&game.project);
        card(cx)
            .flex_row()
            .items_center()
            .gap_4()
            .child(game_mark(
                game.language,
                if compact { 42. } else { 52. },
                cx,
            ))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(
                        div()
                            .font_weight(FontWeight::SEMIBOLD)
                            .truncate()
                            .child(game.name.clone()),
                    )
                    .child(secondary(
                        format!("{}  /  v{}", game.language.label(), game.version),
                        cx,
                    )),
            )
            .when(active && !compact, |view| {
                view.child(pill(text("Last played"), cx))
            })
            .child(
                Button::new(SharedString::from(format!("play-{}", game.project)))
                    .outline()
                    .icon(IconName::Play)
                    .tooltip(text("Start this game"))
                    .when(!compact, |button| button.label(text("Play")))
                    .disabled(self.state.resources_busy())
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.state.start_installed_game(&project);
                        cx.notify();
                    })),
            )
    }

    fn downloads(&self, compact: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let mut body = div().flex().flex_col().gap_5().child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap_3()
                .child(
                    div()
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(text("Release packages")),
                )
                .child(pill(
                    self.state
                        .remote_release_tag
                        .as_deref()
                        .map(|tag| {
                            if tag == "direct downloads" {
                                text(tag).to_owned()
                            } else {
                                tag.to_owned()
                            }
                        })
                        .unwrap_or_else(|| text("Checking release").into()),
                    cx,
                )),
        );
        if self.state.remote_assets_result.is_some() && self.state.remote_assets.is_empty() {
            body = body.child(
                card(cx)
                    .items_center()
                    .py_8()
                    .gap_3()
                    .child(Spinner::new())
                    .child(secondary(text("Finding available packages..."), cx)),
            );
        } else if self.state.remote_assets.is_empty() {
            body = body.child(
                card(cx)
                    .gap_3()
                    .child(text("No release packages available"))
                    .child(secondary(
                        text("Refresh to try again, or install from a URL below."),
                        cx,
                    )),
            );
        } else {
            body = body.child(
                div().flex().flex_col().gap_3().children(
                    self.state
                        .remote_assets
                        .iter()
                        .map(|asset| self.asset_card(asset, compact, cx)),
                ),
            );
        }
        body.child(
            card(cx)
                .gap_3()
                .mt_2()
                .child(
                    div()
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(text("Bring your own world")),
                )
                .child(secondary(
                    text("Paste a resource package URL. We'll install it and start the game."),
                    cx,
                ))
                .child(
                    Input::new(&self.url_input)
                        .id("package-url")
                        .disabled(self.state.resources_busy()),
                )
                .child(
                    div()
                        .flex()
                        .justify_between()
                        .items_center()
                        .gap_3()
                        .child(secondary("ZIP, tar, gzip, zstd, xz, 7z & RAR", cx))
                        .child(
                            Button::new("install-url")
                                .primary()
                                .icon(IconName::Download)
                                .label(text("Install & play"))
                                .disabled(self.state.resources_busy())
                                .on_click(cx.listener(|this, _, _, cx| this.install_url(cx))),
                        ),
                ),
        )
    }

    fn asset_card(
        &self,
        asset: &ReleaseAsset,
        compact: bool,
        cx: &mut Context<Self>,
    ) -> gpui_kit::Div {
        let download = asset.clone();
        let size = if asset.size == 0 {
            text("Release asset").to_owned()
        } else {
            format_size(asset.size)
        };
        card(cx)
            .flex_row()
            .items_center()
            .gap_4()
            .when(!compact, |view| {
                view.child(
                    div()
                        .flex()
                        .items_center()
                        .justify_center()
                        .size(px(48.))
                        .flex_shrink_0()
                        .rounded(px(12.))
                        .bg(tone(0xF4EEE7, 0x383127, cx))
                        .text_color(tone(0xA47B56, 0xD3AD81, cx))
                        .child(Icon::new(IconName::Package).size(px(23.))),
                )
            })
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .gap_2()
                    .child(
                        div()
                            .font_weight(FontWeight::MEDIUM)
                            .truncate()
                            .child(asset.name.clone()),
                    )
                    .child(secondary(size, cx)),
            )
            .child(
                Button::new(SharedString::from(format!("download-{}", asset.name)))
                    .outline()
                    .icon(IconName::Download)
                    .when(!compact, |button| button.label(text("Install & play")))
                    .tooltip(super::release_asset_label(asset))
                    .disabled(self.state.resources_busy())
                    .on_click(cx.listener(move |this, _, _, cx| this.install_asset(&download, cx))),
            )
    }

    fn status(&self, cx: &App) -> impl IntoElement {
        div()
            .flex()
            .items_center()
            .gap_2()
            .px_6()
            .py_3()
            .border_t_1()
            .border_color(cx.theme().border)
            .bg(cx.theme().background)
            .text_size(px(12.))
            .text_color(cx.theme().muted_foreground)
            .when(self.state.downloading, |view| {
                view.child(Spinner::new().small().color(cx.theme().primary))
                    .child(text(
                        "Downloading & installing. Your game will start when ready.",
                    ))
            })
            .when(self.state.clearing, |view| {
                view.child(Spinner::new().small().color(cx.theme().primary))
                    .child(text("Clearing local game resources..."))
            })
            .when(!self.state.resources_busy(), |view| {
                view.child(div().size(px(6.)).rounded_full().bg(rgb(0x839571)))
                    .child(
                        self.state
                            .status_message
                            .clone()
                            .unwrap_or_else(|| text("Ready to play").to_owned()),
                    )
                    .child(div().flex_1())
                    .child("Bevy RuneWeave")
            })
    }
}

impl Render for Launcher {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let compact = window.viewport_size().width < px(780.);
        div()
            .size_full()
            .flex()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .child(self.navigation(compact, cx))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .child(
                        div()
                            .id("launcher-content")
                            .flex_1()
                            .min_h_0()
                            .overflow_y_scrollbar()
                            .p(if compact { px(20.) } else { px(32.) })
                            .child(self.header(compact, cx))
                            .when_some(self.state.error.clone(), |view, error| {
                                view.child(
                                    div()
                                        .flex()
                                        .items_start()
                                        .gap_3()
                                        .p_4()
                                        .mb_5()
                                        .rounded(px(10.))
                                        .bg(tone(0xF9EAE4, 0x3B2724, cx))
                                        .border_1()
                                        .border_color(tone(0xEFD1C4, 0x67423A, cx))
                                        .child(
                                            div()
                                                .flex()
                                                .flex_col()
                                                .flex_1()
                                                .min_w_0()
                                                .gap_1()
                                                .child(
                                                    div()
                                                        .font_weight(FontWeight::SEMIBOLD)
                                                        .text_color(tone(0x9C3D24, 0xF5B8A0, cx))
                                                        .child(text(
                                                            "Something needs your attention",
                                                        )),
                                                )
                                                .child(
                                                    div()
                                                        .text_size(px(12.))
                                                        .text_color(tone(0x8C5643, 0xD4AA9A, cx))
                                                        .child(error),
                                                ),
                                        )
                                        .child(
                                            Button::new("dismiss-error")
                                                .ghost()
                                                .icon(IconName::X)
                                                .tooltip(text("Dismiss error"))
                                                .on_click(cx.listener(|this, _, _, cx| {
                                                    this.state.error = None;
                                                    cx.notify();
                                                })),
                                        ),
                                )
                            })
                            .child(match self.page {
                                Page::Library => self.library(compact, cx).into_any_element(),
                                Page::Downloads => self.downloads(compact, cx).into_any_element(),
                            }),
                    )
                    .child(self.status(cx)),
            )
    }
}

fn card(cx: &App) -> gpui_kit::Div {
    div()
        .flex()
        .flex_col()
        .p_5()
        .rounded(px(14.))
        .bg(tone(0xFFFFFF, 0x222923, cx))
        .border_1()
        .border_color(cx.theme().border)
}

fn secondary(text: impl Into<SharedString>, cx: &App) -> gpui_kit::Div {
    div()
        .text_size(px(12.))
        .text_color(cx.theme().muted_foreground)
        .child(text.into())
}

fn kicker(text: &'static str, cx: &App) -> gpui_kit::Div {
    div()
        .text_size(px(10.))
        .text_color(tone(0x77806C, 0xA4B796, cx))
        .font_weight(FontWeight::SEMIBOLD)
        .child(text)
}

fn pill(text: impl Into<SharedString>, cx: &App) -> gpui_kit::Div {
    div()
        .flex_shrink_0()
        .px_3()
        .py_1()
        .rounded_full()
        .text_size(px(10.))
        .bg(tone(0xEDF2E8, 0x35432F, cx))
        .text_color(tone(0x5B714A, 0xB3C89F, cx))
        .child(text.into())
}

fn game_mark(language: Language, edge: f32, cx: &App) -> gpui_kit::Div {
    let (label, light_bg, light_fg, dark_bg, dark_fg) = match language {
        Language::Js => ("JS", 0xF4EBC6, 0x8B762B, 0x403A24, 0xDFCE85),
        Language::TypeScript => ("TS", 0xDCE8ED, 0x476A80, 0x293D45, 0x99C3D8),
        Language::Lua => ("Lua", 0xE9E0EE, 0x7B5B8D, 0x3D3045, 0xC7AAD9),
    };
    div()
        .flex()
        .flex_shrink_0()
        .items_center()
        .justify_center()
        .size(px(edge))
        .rounded(px(12.))
        .bg(tone(light_bg, dark_bg, cx))
        .text_color(tone(light_fg, dark_fg, cx))
        .text_size(px(edge * 0.28))
        .font_weight(FontWeight::SEMIBOLD)
        .child(label)
}

fn sidebar_button_style(selected: bool, cx: &App) -> ButtonCustomVariant {
    ButtonCustomVariant::new(cx)
        .color(if selected {
            tone(0x414B3F, 0x374330, cx).into()
        } else {
            tone(SIDEBAR, 0x141B16, cx).into()
        })
        .foreground(rgb(if selected { 0xFFFFFF } else { 0xBFC8B8 }).into())
        .hover(rgb(0x414B3F).into())
        .active(rgb(0x4D5948).into())
        .shadow(false)
}

fn tone(light: u32, dark: u32, cx: &App) -> gpui_kit::Rgba {
    rgb(if cx.theme().is_dark() { dark } else { light })
}

fn configure_theme(mode: ThemeMode, cx: &mut App) {
    Theme::change(mode, None, cx);
    let dark = mode.is_dark();
    Theme::update(cx, |theme| {
        theme.font_size = px(14.);
        theme.radius = px(8.);
        theme.colors.primary = rgb(if dark { 0xE58A62 } else { ACCENT }).into();
        theme.colors.primary_hover = rgb(if dark { 0xF1A27E } else { 0xAE4729 }).into();
        theme.colors.primary_active = rgb(if dark { 0xD97A51 } else { 0x943C23 }).into();
        theme.colors.primary_foreground = rgb(if dark { 0x281A12 } else { 0xFFFFFF }).into();
        theme.colors.button_primary = rgb(if dark { 0xE58A62 } else { ACCENT }).into();
        theme.colors.button_primary_hover = rgb(if dark { 0xF1A27E } else { 0xAE4729 }).into();
        theme.colors.button_primary_active = rgb(if dark { 0xD97A51 } else { 0x943C23 }).into();
        theme.colors.button_primary_foreground = rgb(if dark { 0x281A12 } else { 0xFFFFFF }).into();
        theme.colors.ring = rgb(if dark { 0xE58A62 } else { ACCENT }).into();
        theme.colors.background = rgb(if dark { 0x191F1B } else { PAPER }).into();
        theme.colors.foreground = rgb(if dark { 0xE6EAE2 } else { INK }).into();
        theme.colors.border = rgb(if dark { 0x3A4439 } else { LINE }).into();
        theme.colors.muted_foreground = rgb(if dark { 0xA6B09F } else { MUTED }).into();
    });
}

pub(super) fn run() {
    gpui_kit::application().with_assets(AllAssets).run(|cx| {
        gpui_kit::init(cx);
        configure_theme(cx.window_appearance().into(), cx);
        cx.on_window_closed(|cx, _| {
            if cx.windows().is_empty() {
                cx.quit();
            }
        })
        .detach();
        let bounds = Bounds::centered(None, size(px(1040.), px(740.)), cx);
        if let Err(error) = gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                window_min_size: Some(size(px(560.), px(440.))),
                titlebar: Some(TitlebarOptions {
                    title: Some("Bevy RuneWeave".into()),
                    ..Default::default()
                }),
                app_id: Some("com.runeweave.desktop-demo".to_owned()),
                #[cfg(target_os = "linux")]
                icon: image::load_from_memory(include_bytes!(
                    "../../../assets/branding/bevy_icon.png"
                ))
                .ok()
                .map(|image| std::sync::Arc::new(image.into_rgba8())),
                ..Default::default()
            },
            cx,
            |window, cx| cx.new(|cx| Launcher::new(LauncherApp::new(), window, cx)),
        ) {
            eprintln!("Could not open launcher: {error}");
            cx.quit();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui_kit::{AnyWindowHandle, ScrollDelta, TestAppContext, point, test::TestWindowExt};
    use std::sync::mpsc;

    fn state() -> LauncherApp {
        LauncherApp {
            url: String::new(),
            downloading: false,
            clearing: false,
            status_message: None,
            installed_games: Vec::new(),
            active_project: None,
            remote_release_tag: Some("test-release".to_owned()),
            remote_assets: super::super::fallback_release_assets(),
            error: None,
            result: None,
            cleanup_result: None,
            remote_assets_result: None,
        }
    }

    fn open(
        state: LauncherApp,
        width: f32,
        height: f32,
        cx: &mut TestAppContext,
    ) -> (AnyWindowHandle, Entity<Launcher>) {
        cx.update(|cx| {
            gpui_kit::init(cx);
            cx.set_reduce_motion(true);
            configure_theme(cx.window_appearance().into(), cx);
            gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds {
                        origin: point(px(0.), px(0.)),
                        size: size(px(width), px(height)),
                    })),
                    ..Default::default()
                },
                cx,
                |window, cx| cx.new(|cx| Launcher::new(state, window, cx)),
            )
            .unwrap()
        })
    }

    #[gpui_kit::test]
    fn empty_library_can_open_discovery_and_validate_url(cx: &mut TestAppContext) {
        let (handle, content) = open(state(), 1040., 740., cx);
        cx.update_window(handle, |_, window, cx| {
            window.click("browse-games", cx);
            assert!(content.read(cx).page == Page::Downloads);
            window.scroll(
                "download-script-squadron-typescript.zip",
                ScrollDelta::Pixels(point(px(0.), px(-600.))),
                cx,
            );
            window.click("package-url", cx);
            window.press("enter", cx);
        })
        .unwrap();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(
                content.read(cx).state.error.as_deref(),
                Some(text("Enter an asset package URL"))
            );
            assert!(!content.read(cx).state.downloading);
            window.scroll(
                "download-script-squadron-typescript.zip",
                ScrollDelta::Pixels(point(px(0.), px(600.))),
                cx,
            );
            window.click("dismiss-error", cx);
            assert!(content.read(cx).state.error.is_none());
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn clearing_resources_requires_confirmation_and_cancel_keeps_state(cx: &mut TestAppContext) {
        let (handle, content) = open(state(), 1040., 740., cx);
        cx.update_window(handle, |_, window, cx| {
            window.click("clear-resources", cx);
        })
        .unwrap();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert!(window.has_active_dialog(cx));
            assert!(!content.read(cx).state.clearing);
            assert!(content.read(cx).state.cleanup_result.is_none());
            window.within("dialog").click("cancel", cx);
        })
        .unwrap();
        cx.update_window(handle, |_, window, cx| {
            assert!(!window.has_active_dialog(cx));
            assert!(!content.read(cx).state.clearing);
            assert!(content.read(cx).state.cleanup_result.is_none());
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn cleanup_blocks_installs_refresh_and_repeated_cleanup(cx: &mut TestAppContext) {
        let mut initial = state();
        initial.clearing = true;
        let (handle, content) = open(initial, 560., 440., cx);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(window.find("clear-resources").disabled(), Some(true));
            assert_eq!(window.find("refresh").disabled(), Some(true));
            window.click("clear-resources", cx);
            assert!(!window.has_active_dialog(cx));
            window.click("Discover", cx);
            assert_eq!(window.find("install-url").disabled(), Some(true));
            assert_eq!(
                window
                    .find("download-script-squadron-typescript.zip")
                    .disabled(),
                Some(true)
            );
            content.update(cx, |view, _| {
                view.state.url = "https://example.com/game.zip".to_owned();
                view.state.start_download();
                view.state.start_installed_game("demo");
                view.state.start_cleanup();
                assert!(view.state.result.is_none());
                assert!(view.state.cleanup_result.is_none());
                assert!(view.state.active_project.is_none());
            });
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn installation_disables_launch_and_install_until_worker_returns(cx: &mut TestAppContext) {
        let mut initial = state();
        initial.installed_games.push(InstalledGame {
            project: "demo".to_owned(),
            name: "Demo".to_owned(),
            version: "1.0".to_owned(),
            language: Language::TypeScript,
        });
        initial.active_project = Some("demo".to_owned());
        let (sender, receiver) = mpsc::channel();
        initial.downloading = true;
        initial.result = Some(receiver);
        let (handle, content) = open(initial, 1040., 740., cx);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(window.find("play-featured").disabled(), Some(true));
            assert_eq!(window.find("play-demo").disabled(), Some(true));
            window.click("Discover", cx);
            assert_eq!(window.find("install-url").disabled(), Some(true));
            window.scroll(
                "download-script-squadron-typescript.zip",
                ScrollDelta::Pixels(point(px(0.), px(-600.))),
                cx,
            );
            window.click("package-url", cx);
            window.input("ignored while downloading", cx);
            assert!(content.read(cx).url_input.read(cx).value().is_empty());
            window.click("install-url", cx);
            assert!(content.read(cx).state.downloading);

            sender.send(Err("Network unavailable".to_owned())).unwrap();
            content.update(cx, |view, cx| {
                assert!(view.state.poll_download());
                cx.notify();
            });
            window.render_frame(cx);
            assert_ne!(window.find("install-url").disabled(), Some(true));
            assert_eq!(
                content.read(cx).state.error.as_deref(),
                Some("Network unavailable")
            );
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn compact_layout_keeps_navigation_and_actions_inside_the_window(cx: &mut TestAppContext) {
        let (handle, content) = open(state(), 560., 440., cx);
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            for id in ["My library", "Discover", "refresh", "browse-games"] {
                let bounds = window.find(id).bounds();
                assert!(
                    bounds.origin.x >= px(0.) && bounds.right() <= px(560.),
                    "{id}: {bounds:?}"
                );
            }
            window.click("Discover", cx);
            assert!(content.read(cx).page == Page::Downloads);
            let bounds = window
                .find("download-script-squadron-typescript.zip")
                .bounds();
            assert!(bounds.right() <= px(560.));
            assert!(bounds.bottom() <= px(440.));
        })
        .unwrap();
    }

    #[test]
    fn disconnected_download_worker_restores_idle_state() {
        let mut state = state();
        let (sender, receiver) = mpsc::channel();
        state.downloading = true;
        state.result = Some(receiver);
        drop(sender);
        assert!(state.poll_download());
        assert!(!state.downloading);
        assert!(state.result.is_none());
        assert_eq!(
            state.error.as_deref(),
            Some(text("Download worker stopped unexpectedly"))
        );
    }

    #[gpui_kit::test]
    fn light_and_dark_palettes_preserve_both_pages_and_input(cx: &mut TestAppContext) {
        use gpui_kit::WindowAppearance;

        let (handle, content) = open(state(), 1040., 740., cx);
        cx.update_window(handle, |_, window, cx| {
            content.update(cx, |view, cx| {
                view.url_input.update(cx, |input, cx| {
                    input.set_value("https://example.com/saved.zip", window, cx);
                });
            });
        })
        .unwrap();
        for appearance in [
            WindowAppearance::Dark,
            WindowAppearance::Light,
            WindowAppearance::VibrantDark,
            WindowAppearance::VibrantLight,
        ] {
            cx.update_window(handle, |_, window, cx| {
                configure_theme(appearance.into(), cx);
                let dark = ThemeMode::from(appearance).is_dark();
                assert_eq!(cx.theme().is_dark(), dark);
                assert_eq!(
                    cx.theme().background,
                    rgb(if dark { 0x191F1B } else { PAPER }).into()
                );
                assert_eq!(
                    cx.theme().button_primary,
                    rgb(if dark { 0xE58A62 } else { ACCENT }).into()
                );
                assert_eq!(
                    content.read(cx).url_input.read(cx).value(),
                    "https://example.com/saved.zip"
                );
                window.render_frame(cx);
                window.click("Discover", cx);
                assert!(window.try_find("install-url").is_some());
                window.click("My library", cx);
                assert!(window.try_find("browse-games").is_some());
            })
            .unwrap();
        }
    }

    #[test]
    fn release_results_are_applied_and_disconnected_workers_report_an_error() {
        let mut state = state();
        let (sender, receiver) = mpsc::channel();
        state.remote_assets_result = Some(receiver);
        assert!(!state.poll_remote_assets());
        sender.send(Ok(("v2".to_owned(), Vec::new()))).unwrap();
        assert!(state.poll_remote_assets());
        assert_eq!(state.remote_release_tag.as_deref(), Some("v2"));
        assert!(state.remote_assets.is_empty());
        assert!(state.remote_assets_result.is_none());

        let (sender, receiver) = mpsc::channel();
        state.remote_assets_result = Some(receiver);
        drop(sender);
        assert!(state.poll_remote_assets());
        assert!(state.remote_assets_result.is_none());
        assert!(
            state
                .error
                .as_deref()
                .unwrap()
                .contains(text("Release worker stopped unexpectedly"))
        );
    }
}
