use std::{
    fs,
    path::Path,
    sync::{Arc, Mutex},
};

use super::super::RenderCache;
use super::super::RenderSessionRegistry;

pub fn write_sample_pdf(path: &Path, label: &str) {
    write_valid_pdf(path, label);
}

pub fn write_valid_pdf(path: &Path, text: &str) {
    write_valid_pdf_pages(path, &[text]);
}

pub fn write_valid_pdf_pages(path: &Path, texts: &[&str]) {
    fn push_object(buffer: &mut Vec<u8>, offsets: &mut Vec<usize>, object_id: u32, body: &str) {
        offsets.push(buffer.len());
        buffer.extend_from_slice(format!("{object_id} 0 obj\n{body}\nendobj\n").as_bytes());
    }

    let mut pdf = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    let page_count = texts.len().max(1) as u32;
    let font_object_id = 3 + (page_count * 2);

    let page_object_ids = (0..page_count)
        .map(|index| 3 + (index * 2))
        .collect::<Vec<_>>();
    let kids = page_object_ids
        .iter()
        .map(|object_id| format!("{object_id} 0 R"))
        .collect::<Vec<_>>()
        .join(" ");

    push_object(
        &mut pdf,
        &mut offsets,
        1,
        "<< /Type /Catalog /Pages 2 0 R >>",
    );
    push_object(
        &mut pdf,
        &mut offsets,
        2,
        &format!("<< /Type /Pages /Kids [{kids}] /Count {page_count} >>"),
    );

    for (index, text) in texts.iter().enumerate() {
        let page_object_id = 3 + (index as u32 * 2);
        let content_object_id = page_object_id + 1;
        let content = format!("BT /F1 18 Tf 40 120 Td ({text}) Tj ET");

        push_object(
            &mut pdf,
            &mut offsets,
            page_object_id,
            &format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 {font_object_id} 0 R >> >> /Contents {content_object_id} 0 R >>"
            ),
        );
        push_object(
            &mut pdf,
            &mut offsets,
            content_object_id,
            &format!(
                "<< /Length {} >>\nstream\n{}\nendstream",
                content.len(),
                content
            ),
        );
    }

    push_object(
        &mut pdf,
        &mut offsets,
        font_object_id,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    );

    let xref_offset = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n", offsets.len() + 1).as_bytes());
    pdf.extend_from_slice(b"0000000000 65535 f \n");
    for offset in offsets {
        pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n",
            font_object_id + 1
        )
        .as_bytes(),
    );

    fs::write(path, pdf).unwrap();
}

pub fn create_render_cache() -> Arc<Mutex<RenderCache>> {
    Arc::new(Mutex::new(RenderCache::default()))
}

pub fn create_render_sessions() -> RenderSessionRegistry {
    RenderSessionRegistry::default()
}

pub fn create_render_sessions_with_budget(byte_budget: usize) -> RenderSessionRegistry {
    RenderSessionRegistry::with_display_list_byte_budget(byte_budget)
}
