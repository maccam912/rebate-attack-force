//! Text construction using Bevy's built-in default font.

use bevy::prelude::*;
use bevy::sprite::Anchor;

pub mod size {
    pub const CONTROLS: f32 = 11.0;
    pub const SMALL: f32 = 12.0;
    pub const LABEL: f32 = 13.0;
    pub const STATUS: f32 = 15.0;
    pub const SCORE: f32 = 16.0;
    pub const LOBBY: f32 = 17.0;
    pub const CONNECTION: f32 = 24.0;
    pub const PHASE: f32 = 26.0;
    pub const BANNER: f32 = 54.0;
}

fn supported_text(value: impl Into<String>) -> String {
    value
        .into()
        .chars()
        .map(|ch| {
            if ch == '\n' || (' '..='~').contains(&ch) {
                ch
            } else {
                '?'
            }
        })
        .collect()
}

pub fn ui(
    value: impl Into<String>,
    font_size: f32,
    color: Color,
) -> (Text, TextFont, TextColor) {
    (
        Text::new(supported_text(value)),
        TextFont::from_font_size(font_size),
        TextColor(color),
    )
}

pub fn world(
    value: impl Into<String>,
    font_size: f32,
    color: Color,
) -> (Text2d, TextFont, TextColor, TextLayout, Anchor) {
    (
        Text2d::new(supported_text(value)),
        TextFont::from_font_size(font_size),
        TextColor(color),
        TextLayout::new_with_justify(Justify::Center),
        Anchor::CENTER,
    )
}

pub fn set_ui(text: &mut Text, value: impl Into<String>) {
    let value = supported_text(value);
    if text.0 != value {
        text.0 = value;
    }
}

pub fn set_world(text: &mut Text2d, value: impl Into<String>) {
    let value = supported_text(value);
    if text.0 != value {
        text.0 = value;
    }
}
