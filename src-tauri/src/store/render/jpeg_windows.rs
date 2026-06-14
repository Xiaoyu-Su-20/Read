use std::{path::Path, sync::OnceLock};

use mupdf::Pixmap;

#[cfg(target_os = "windows")]
pub fn write_pixmap_as_jpeg(path: &Path, pixmap: &Pixmap, quality: u32) -> Result<(), String> {
    use std::{ffi::c_void, os::windows::ffi::OsStrExt, ptr};

    type GpStatus = i32;
    type GpBitmap = c_void;
    type GpImage = c_void;
    type UlongPtr = usize;

    #[repr(C)]
    struct GdiplusStartupInput {
        gdi_plus_version: u32,
        debug_event_callback: *const c_void,
        suppress_background_thread: i32,
        suppress_external_codecs: i32,
    }

    #[repr(C)]
    struct Guid {
        data1: u32,
        data2: u16,
        data3: u16,
        data4: [u8; 8],
    }

    #[repr(C)]
    struct EncoderParameter {
        guid: Guid,
        number_of_values: u32,
        r#type: u32,
        value: *mut c_void,
    }

    #[repr(C)]
    struct EncoderParameters {
        count: u32,
        parameter: [EncoderParameter; 1],
    }

    const OK: GpStatus = 0;
    const PIXEL_FORMAT_24BPP_RGB: i32 = 137224;
    const ENCODER_PARAMETER_VALUE_TYPE_LONG: u32 = 4;

    #[link(name = "gdiplus")]
    unsafe extern "system" {
        fn GdiplusStartup(
            token: *mut UlongPtr,
            input: *const GdiplusStartupInput,
            output: *mut c_void,
        ) -> GpStatus;
        fn GdipCreateBitmapFromScan0(
            width: i32,
            height: i32,
            stride: i32,
            pixel_format: i32,
            scan0: *mut u8,
            bitmap: *mut *mut GpBitmap,
        ) -> GpStatus;
        fn GdipSaveImageToFile(
            image: *mut GpImage,
            filename: *const u16,
            clsid_encoder: *const Guid,
            encoder_params: *const EncoderParameters,
        ) -> GpStatus;
        fn GdipDisposeImage(image: *mut GpImage) -> GpStatus;
    }

    fn status_to_result(status: GpStatus, action: &str) -> Result<(), String> {
        if status == OK {
            Ok(())
        } else {
            Err(format!("{action} failed with GDI+ status {status}."))
        }
    }

    static GDI_PLUS_TOKEN: OnceLock<Result<UlongPtr, String>> = OnceLock::new();

    let token_result = GDI_PLUS_TOKEN.get_or_init(|| {
        let mut token = 0;
        let input = GdiplusStartupInput {
            gdi_plus_version: 1,
            debug_event_callback: ptr::null(),
            suppress_background_thread: 0,
            suppress_external_codecs: 0,
        };
        let status = unsafe { GdiplusStartup(&mut token, &input, ptr::null_mut()) };
        status_to_result(status, "GdiplusStartup").map(|_| token)
    });
    if let Err(error) = token_result {
        return Err(error.clone());
    }

    let width = pixmap.width();
    let height = pixmap.height();
    let component_count = pixmap.n() as usize;
    if component_count < 3 {
        return Err("MuPDF produced fewer than three color channels.".to_string());
    }

    let output_stride = ((width as usize * 3) + 3) & !3;
    let mut output = vec![0u8; output_stride * height as usize];
    let samples = pixmap.samples();

    for y in 0..height as usize {
        let source_row = y * width as usize * component_count;
        let target_row = y * output_stride;
        for x in 0..width as usize {
            let source_offset = source_row + (x * component_count);
            let target_offset = target_row + (x * 3);
            output[target_offset] = samples[source_offset + 2];
            output[target_offset + 1] = samples[source_offset + 1];
            output[target_offset + 2] = samples[source_offset];
        }
    }

    let jpeg_clsid = Guid {
        data1: 0x557cf401,
        data2: 0x1a04,
        data3: 0x11d3,
        data4: [0x9a, 0x73, 0x00, 0x00, 0xf8, 0x1e, 0xf3, 0x2e],
    };
    let encoder_quality_guid = Guid {
        data1: 0x1d5be4b5,
        data2: 0xfa4a,
        data3: 0x452d,
        data4: [0x9c, 0xdd, 0x5d, 0xb3, 0x51, 0x05, 0xe7, 0xeb],
    };
    let mut quality_value = quality;
    let encoder_parameters = EncoderParameters {
        count: 1,
        parameter: [EncoderParameter {
            guid: encoder_quality_guid,
            number_of_values: 1,
            r#type: ENCODER_PARAMETER_VALUE_TYPE_LONG,
            value: (&mut quality_value as *mut u32).cast(),
        }],
    };

    let mut bitmap = ptr::null_mut();
    let create_status = unsafe {
        GdipCreateBitmapFromScan0(
            width as i32,
            height as i32,
            output_stride as i32,
            PIXEL_FORMAT_24BPP_RGB,
            output.as_mut_ptr(),
            &mut bitmap,
        )
    };
    status_to_result(create_status, "GdipCreateBitmapFromScan0")?;

    let wide_path = path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<u16>>();
    let save_result = unsafe {
        GdipSaveImageToFile(
            bitmap.cast(),
            wide_path.as_ptr(),
            &jpeg_clsid,
            &encoder_parameters,
        )
    };
    let dispose_result = unsafe { GdipDisposeImage(bitmap.cast()) };

    status_to_result(save_result, "GdipSaveImageToFile")?;
    status_to_result(dispose_result, "GdipDisposeImage")?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn write_pixmap_as_jpeg(_path: &Path, _pixmap: &Pixmap, _quality: u32) -> Result<(), String> {
    Err("JPEG output is only implemented for Windows in this build.".to_string())
}
