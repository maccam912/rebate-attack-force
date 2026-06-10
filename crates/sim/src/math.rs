use serde::{Deserialize, Serialize};
use std::ops::{Add, AddAssign, Mul, Neg, Sub, SubAssign};

/// Sim coordinates are y-down (matches the terrain grid); "up" is -y.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Vec2 {
    pub x: f32,
    pub y: f32,
}

pub const fn v2(x: f32, y: f32) -> Vec2 {
    Vec2 { x, y }
}

impl Vec2 {
    pub const ZERO: Vec2 = v2(0.0, 0.0);

    pub fn dot(self, o: Vec2) -> f32 {
        self.x * o.x + self.y * o.y
    }
    pub fn length(self) -> f32 {
        self.dot(self).sqrt()
    }
    pub fn length_sq(self) -> f32 {
        self.dot(self)
    }
    pub fn normalized(self) -> Vec2 {
        let l = self.length();
        if l > 1e-6 {
            v2(self.x / l, self.y / l)
        } else {
            Vec2::ZERO
        }
    }
    /// Perpendicular (rotated 90 degrees).
    pub fn perp(self) -> Vec2 {
        v2(-self.y, self.x)
    }
    /// 2D cross product (z component of the 3D cross).
    pub fn cross(self, o: Vec2) -> f32 {
        self.x * o.y - self.y * o.x
    }
    pub fn clamp_length(self, max: f32) -> Vec2 {
        let l2 = self.length_sq();
        if l2 > max * max {
            let l = l2.sqrt();
            v2(self.x / l * max, self.y / l * max)
        } else {
            self
        }
    }
    pub fn distance(self, o: Vec2) -> f32 {
        (self - o).length()
    }
    pub fn lerp(self, o: Vec2, t: f32) -> Vec2 {
        self + (o - self) * t
    }
}

impl Add for Vec2 {
    type Output = Vec2;
    fn add(self, o: Vec2) -> Vec2 {
        v2(self.x + o.x, self.y + o.y)
    }
}
impl Sub for Vec2 {
    type Output = Vec2;
    fn sub(self, o: Vec2) -> Vec2 {
        v2(self.x - o.x, self.y - o.y)
    }
}
impl Mul<f32> for Vec2 {
    type Output = Vec2;
    fn mul(self, s: f32) -> Vec2 {
        v2(self.x * s, self.y * s)
    }
}
impl Neg for Vec2 {
    type Output = Vec2;
    fn neg(self) -> Vec2 {
        v2(-self.x, -self.y)
    }
}
impl AddAssign for Vec2 {
    fn add_assign(&mut self, o: Vec2) {
        *self = *self + o;
    }
}
impl SubAssign for Vec2 {
    fn sub_assign(&mut self, o: Vec2) {
        *self = *self - o;
    }
}
