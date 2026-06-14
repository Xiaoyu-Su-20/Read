use std::collections::VecDeque;

use super::manifest::NormalizationRect;

#[derive(Debug, Clone)]
pub struct DetectionResult {
    pub paper_box: NormalizationRect,
    pub content_box: NormalizationRect,
    pub confidence: f32,
    pub content_coverage: f32,
    pub paper_gray: u8,
    pub blank: bool,
}

fn percentile(values: &mut [u8], fraction: f32) -> u8 {
    if values.is_empty() {
        return 255;
    }
    values.sort_unstable();
    values[((values.len() - 1) as f32 * fraction).round() as usize]
}

fn bounds_for_mask(
    mask: &[bool],
    width: usize,
    height: usize,
) -> Option<(usize, usize, usize, usize)> {
    let mut x0 = width;
    let mut y0 = height;
    let mut x1 = 0usize;
    let mut y1 = 0usize;
    let mut found = false;
    for y in 0..height {
        for x in 0..width {
            if !mask[y * width + x] {
                continue;
            }
            found = true;
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x + 1);
            y1 = y1.max(y + 1);
        }
    }
    found.then_some((x0, y0, x1, y1))
}

fn component_mask(mask: &[bool], width: usize, height: usize, min_size: usize) -> Vec<bool> {
    let mut visited = vec![false; mask.len()];
    let mut kept = vec![false; mask.len()];
    for start in 0..mask.len() {
        if !mask[start] || visited[start] {
            continue;
        }
        let mut queue = VecDeque::from([start]);
        let mut component = Vec::new();
        visited[start] = true;
        while let Some(index) = queue.pop_front() {
            component.push(index);
            let x = index % width;
            let y = index / width;
            for (nx, ny) in [
                (x.wrapping_sub(1), y),
                (x + 1, y),
                (x, y.wrapping_sub(1)),
                (x, y + 1),
            ] {
                if nx >= width || ny >= height {
                    continue;
                }
                let next = ny * width + nx;
                if mask[next] && !visited[next] {
                    visited[next] = true;
                    queue.push_back(next);
                }
            }
        }
        if component.len() >= min_size {
            for index in component {
                kept[index] = true;
            }
        }
    }
    kept
}

fn projection_bounds(
    mask: &[bool],
    width: usize,
    height: usize,
    bounds: (usize, usize, usize, usize),
) -> Option<(usize, usize, usize, usize)> {
    let (x0, y0, x1, y1) = bounds;
    let row_threshold = ((x1 - x0) / 120).max(1);
    let column_threshold = ((y1 - y0) / 120).max(1);
    let rows = (y0..y1)
        .filter(|y| (x0..x1).filter(|x| mask[*y * width + *x]).count() >= row_threshold)
        .collect::<Vec<_>>();
    let columns = (x0..x1)
        .filter(|x| (y0..y1).filter(|y| mask[*y * width + *x]).count() >= column_threshold)
        .collect::<Vec<_>>();
    Some((
        *columns.first()?,
        *rows.first()?,
        *columns.last()? + 1,
        *rows.last()? + 1,
    ))
}

pub fn detect_regions(gray: &[u8], width: usize, height: usize) -> DetectionResult {
    if width == 0 || height == 0 || gray.len() < width * height {
        return DetectionResult {
            paper_box: NormalizationRect {
                x: 0.0,
                y: 0.0,
                width: width.max(1) as f32,
                height: height.max(1) as f32,
            },
            content_box: NormalizationRect {
                x: 0.0,
                y: 0.0,
                width: width.max(1) as f32,
                height: height.max(1) as f32,
            },
            confidence: 0.0,
            content_coverage: 0.0,
            paper_gray: 255,
            blank: true,
        };
    }

    let corner = (width.min(height) / 12).max(2);
    let mut corners = Vec::with_capacity(corner * corner * 4);
    for y in 0..height {
        for x in 0..width {
            if (x < corner || x >= width - corner) && (y < corner || y >= height - corner) {
                corners.push(gray[y * width + x]);
            }
        }
    }
    let corner_gray = percentile(&mut corners, 0.5);
    let mut all = gray.to_vec();
    let median_gray = percentile(&mut all, 0.5);
    let border_contrast = (median_gray as i16 - corner_gray as i16).unsigned_abs() as u8;

    let mut paper_mask = vec![true; width * height];
    if border_contrast >= 14 {
        let threshold = ((median_gray as u16 + corner_gray as u16) / 2) as u8;
        let light_paper = median_gray > corner_gray;
        for (index, value) in gray.iter().copied().enumerate().take(width * height) {
            paper_mask[index] = if light_paper {
                value >= threshold
            } else {
                value <= threshold
            };
        }
    }
    let paper_bounds = bounds_for_mask(&paper_mask, width, height).unwrap_or((0, 0, width, height));
    let (px0, py0, px1, py1) = paper_bounds;

    let mut paper_values = Vec::new();
    for y in py0..py1 {
        for x in px0..px1 {
            paper_values.push(gray[y * width + x]);
        }
    }
    let paper_gray = percentile(&mut paper_values, 0.65);
    let content_threshold = 22i16.max((border_contrast as i16) / 2);
    let mut raw_content = vec![false; width * height];
    for y in py0..py1 {
        for x in px0..px1 {
            let index = y * width + x;
            raw_content[index] =
                (gray[index] as i16 - paper_gray as i16).abs() >= content_threshold;
        }
    }

    let min_component = ((width * height) / 25_000).max(2);
    let content_mask = component_mask(&raw_content, width, height, min_component);
    let content_pixels = content_mask.iter().filter(|value| **value).count();
    let paper_area = ((px1 - px0) * (py1 - py0)).max(1);
    let coverage = content_pixels as f32 / paper_area as f32;
    let blank = coverage < 0.0015;
    let component_bounds =
        bounds_for_mask(&content_mask, width, height).unwrap_or((px0, py0, px1, py1));
    let content_bounds = projection_bounds(&content_mask, width, height, component_bounds)
        .unwrap_or(component_bounds);

    let border_score = (border_contrast as f32 / 48.0).clamp(0.0, 1.0);
    let content_score = (coverage / 0.04).clamp(0.0, 1.0);
    let confidence = if blank {
        0.55 + border_score * 0.2
    } else {
        (0.45 + border_score * 0.25 + content_score * 0.3).clamp(0.0, 1.0)
    };

    DetectionResult {
        paper_box: NormalizationRect {
            x: px0 as f32,
            y: py0 as f32,
            width: (px1 - px0) as f32,
            height: (py1 - py0) as f32,
        },
        content_box: NormalizationRect {
            x: content_bounds.0 as f32,
            y: content_bounds.1 as f32,
            width: (content_bounds.2 - content_bounds.0) as f32,
            height: (content_bounds.3 - content_bounds.1) as f32,
        },
        confidence,
        content_coverage: coverage,
        paper_gray,
        blank,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_light_paper_inside_dark_scanner_border() {
        let mut image = vec![20u8; 100 * 120];
        for y in 10..110 {
            for x in 8..92 {
                image[y * 100 + x] = 240;
            }
        }
        for y in 30..90 {
            for x in 30..70 {
                if x % 6 == 0 || y % 9 == 0 {
                    image[y * 100 + x] = 40;
                }
            }
        }
        let result = detect_regions(&image, 100, 120);
        assert!(result.paper_box.x >= 7.0);
        assert!(result.paper_box.width <= 86.0);
        assert!(result.content_coverage > 0.01);
        assert!(result.confidence >= 0.6);
    }

    #[test]
    fn classifies_uniform_pages_as_blank() {
        let result = detect_regions(&vec![245u8; 80 * 100], 80, 100);
        assert!(result.blank);
        assert_eq!(result.content_coverage, 0.0);
    }
}
