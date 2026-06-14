use super::{
    analyzer::PageMeasurement,
    manifest::{CanonicalFrame, PageClassification, PageNormalizationEntry},
};

fn median(mut values: Vec<f32>) -> f32 {
    values.sort_by(|left, right| left.total_cmp(right));
    let middle = values.len() / 2;
    if values.len() % 2 == 0 {
        (values[middle - 1] + values[middle]) / 2.0
    } else {
        values[middle]
    }
}

pub fn build_transforms(
    measurements: &mut [PageMeasurement],
) -> (CanonicalFrame, Vec<PageNormalizationEntry>) {
    let ordinary = measurements
        .iter()
        .filter(|page| {
            matches!(
                page.classification,
                PageClassification::Body | PageClassification::ChapterOpener
            )
        })
        .collect::<Vec<_>>();
    let basis = if ordinary.is_empty() {
        measurements.iter().collect::<Vec<_>>()
    } else {
        ordinary
    };
    let frame_width = median(basis.iter().map(|page| page.source_crop.width).collect()).max(1.0);
    let frame_height = median(basis.iter().map(|page| page.source_crop.height).collect()).max(1.0);
    let safe_padding = (frame_width.min(frame_height) * 0.03).max(4.0);
    let background_gray = median(
        measurements
            .iter()
            .map(|page| page.paper_gray as f32)
            .collect(),
    )
    .round()
    .clamp(0.0, 255.0) as u8;
    let frame = CanonicalFrame {
        width: frame_width,
        height: frame_height,
        anchor_policy: "topCenter".to_string(),
        safe_padding,
        background_gray,
    };

    let target_width = (frame.width - safe_padding * 2.0).max(1.0);
    let target_height = (frame.height - safe_padding * 2.0).max(1.0);
    let frame_aspect = frame.width / frame.height;
    let mut pages = Vec::with_capacity(measurements.len());

    for measurement in measurements {
        let crop_aspect = measurement.source_crop.width / measurement.source_crop.height;
        if matches!(measurement.classification, PageClassification::Body)
            && ((crop_aspect / frame_aspect) - 1.0).abs() > 0.22
        {
            measurement.classification = PageClassification::GeometricOutlier;
        }

        let rotated = measurement.rotation_correction.rem_euclid(180) == 90;
        let source_width = if rotated {
            measurement.source_crop.height
        } else {
            measurement.source_crop.width
        };
        let source_height = if rotated {
            measurement.source_crop.width
        } else {
            measurement.source_crop.height
        };
        let scale = (target_width / source_width)
            .min(target_height / source_height)
            .max(0.001);
        let placed_width = source_width * scale;
        let placed_height = source_height * scale;
        let offset_x = ((frame.width - placed_width) / 2.0).max(0.0);
        let offset_y = if matches!(
            measurement.classification,
            PageClassification::Body | PageClassification::ChapterOpener
        ) {
            safe_padding
        } else {
            ((frame.height - placed_height) / 2.0).max(0.0)
        };

        pages.push(PageNormalizationEntry {
            page_number: measurement.page_number,
            source_crop_box: measurement.source_crop,
            rotation: measurement.rotation_correction,
            scale,
            offset_x,
            offset_y,
            classification: measurement.classification,
            confidence: measurement.confidence,
        });
    }

    (frame, pages)
}
