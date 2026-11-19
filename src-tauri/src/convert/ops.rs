//! The actual conversions. Images and PDFs are handled in-process; office
//! documents, PDF→image and audio/video use external tools (see `tools`).

use super::tools::{self, Tool};
use lopdf::{dictionary, Document, Object, ObjectId, Stream};
use std::{
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

pub type Progress<'a> = &'a dyn Fn(f64);

/// A path next to `src` with the new extension that doesn't overwrite
/// anything: "photo.png" -> "photo.jpg", or "photo (1).jpg" if taken.
pub fn unique_output(src: &Path, ext: &str, suffix: &str) -> PathBuf {
    let dir = src.parent().unwrap_or(Path::new("."));
    let stem = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "converted".into());
    let base = format!("{stem}{suffix}");
    let mut p = dir.join(format!("{base}.{ext}"));
    let mut n = 1;
    while p.exists() {
        p = dir.join(format!("{base} ({n}).{ext}"));
        n += 1;
    }
    p
}

fn hide_console(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

// ---- Images -------------------------------------------------------------------

pub fn image_to(src: &Path, ext: &str) -> Result<PathBuf, String> {
    let img = image::open(src).map_err(|e| format!("Couldn't read image: {e}"))?;
    let out = unique_output(src, ext, "");
    match ext {
        "jpg" => {
            let rgb = img.to_rgb8();
            let mut f = std::fs::File::create(&out).map_err(|e| e.to_string())?;
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut f, 90)
                .encode_image(&rgb)
                .map_err(|e| e.to_string())?;
        }
        _ => img.save(&out).map_err(|e| format!("Couldn't save {ext}: {e}"))?,
    }
    Ok(out)
}

/// One PDF page per image (JPEG-compressed), page size matching the image.
pub fn images_to_pdf(srcs: &[PathBuf], progress: Progress) -> Result<PathBuf, String> {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let mut kids = Vec::new();
    for (i, src) in srcs.iter().enumerate() {
        let img = image::open(src).map_err(|e| format!("{}: {e}", src.display()))?.to_rgb8();
        let (w, h) = img.dimensions();
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 90)
            .encode_image(&img)
            .map_err(|e| e.to_string())?;
        let xobj = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject", "Subtype" => "Image", "Width" => w as i64, "Height" => h as i64,
                "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 8, "Filter" => "DCTDecode",
            },
            jpeg,
        ));
        // 96 dpi pixels -> 72 dpi points.
        let (pw, ph) = (w as f64 * 0.75, h as f64 * 0.75);
        let content = format!("q {pw:.2} 0 0 {ph:.2} 0 0 cm /Im0 Do Q");
        let content_id = doc.add_object(Stream::new(dictionary! {}, content.into_bytes()));
        let page = doc.add_object(dictionary! {
            "Type" => "Page", "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), Object::Real(pw as f32), Object::Real(ph as f32)],
            "Contents" => content_id,
            "Resources" => dictionary! { "XObject" => dictionary! { "Im0" => xobj } },
        });
        kids.push(Object::Reference(page));
        progress((i + 1) as f64 / srcs.len() as f64);
    }
    let count = kids.len() as i64;
    doc.objects.insert(pages_id, Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => kids, "Count" => count }));
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog);
    doc.compress();
    let out = unique_output(&srcs[0], "pdf", if srcs.len() > 1 { " (combined)" } else { "" });
    doc.save(&out).map_err(|e| e.to_string())?;
    Ok(out)
}

// ---- PDF ----------------------------------------------------------------------

pub fn merge_pdfs(srcs: &[PathBuf], progress: Progress) -> Result<PathBuf, String> {
    let mut max_id = 1;
    let mut pages: Vec<(ObjectId, Object)> = Vec::new();
    let mut objects = std::collections::BTreeMap::new();
    for (i, p) in srcs.iter().enumerate() {
        let mut doc = Document::load(p).map_err(|e| format!("{}: {e}", p.display()))?;
        doc.renumber_objects_with(max_id);
        max_id = doc.max_id + 1;
        for (_, id) in doc.get_pages() {
            if let Ok(o) = doc.get_object(id) {
                pages.push((id, o.clone()));
            }
        }
        objects.extend(doc.objects);
        progress((i + 1) as f64 / srcs.len() as f64 * 0.8);
    }
    let mut out_doc = Document::with_version("1.5");
    let mut catalog: Option<(ObjectId, Object)> = None;
    let mut pages_root: Option<(ObjectId, Object)> = None;
    for (id, obj) in objects.iter() {
        match obj.type_name().unwrap_or(b"") {
            b"Catalog" => {
                if catalog.is_none() {
                    catalog = Some((*id, obj.clone()));
                }
            }
            b"Pages" => {
                if pages_root.is_none() {
                    pages_root = Some((*id, obj.clone()));
                }
            }
            b"Page" | b"Outlines" | b"Outline" => {}
            _ => {
                out_doc.objects.insert(*id, obj.clone());
            }
        }
    }
    let (pages_id, pages_obj) = pages_root.ok_or("No pages found")?;
    let (catalog_id, catalog_obj) = catalog.ok_or("Not a valid PDF (no catalog)")?;
    for (id, obj) in &pages {
        if let Ok(d) = obj.as_dict() {
            let mut d = d.clone();
            d.set("Parent", pages_id);
            out_doc.objects.insert(*id, Object::Dictionary(d));
        }
    }
    let mut pd = pages_obj.as_dict().map_err(|e| e.to_string())?.clone();
    pd.set("Count", pages.len() as i64);
    pd.set("Kids", pages.iter().map(|(id, _)| Object::Reference(*id)).collect::<Vec<_>>());
    out_doc.objects.insert(pages_id, Object::Dictionary(pd));
    let mut cd = catalog_obj.as_dict().map_err(|e| e.to_string())?.clone();
    cd.set("Pages", pages_id);
    cd.remove(b"Outlines");
    out_doc.objects.insert(catalog_id, Object::Dictionary(cd));
    out_doc.trailer.set("Root", catalog_id);
    out_doc.max_id = out_doc.objects.keys().map(|k| k.0).max().unwrap_or(1);
    out_doc.renumber_objects();
    out_doc.compress();
    let out = unique_output(&srcs[0], "pdf", " (merged)");
    out_doc.save(&out).map_err(|e| e.to_string())?;
    progress(1.0);
    Ok(out)
}

/// Lossless clean-up: drop unused objects and compress every stream.
pub fn compress_pdf(src: &Path) -> Result<PathBuf, String> {
    let mut doc = Document::load(src).map_err(|e| format!("Couldn't read PDF: {e}"))?;
    doc.prune_objects();
    doc.delete_zero_length_streams();
    doc.compress();
    let out = unique_output(src, "pdf", " (compressed)");
    doc.save(&out).map_err(|e| e.to_string())?;
    Ok(out)
}

/// Every page of a PDF to JPG (Poppler's pdftoppm), saved in a folder.
pub fn pdf_to_jpg(src: &Path) -> Result<PathBuf, String> {
    let exe = tools::find(Tool::Poppler).ok_or("Poppler is not installed")?;
    let stem = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let dir = unique_output(src, "", " (pages)");
    let dir = dir.with_extension("");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let status = hide_console(Command::new(exe).args(["-jpeg", "-r", "150"]).arg(src).arg(dir.join(&stem)))
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("pdftoppm failed".into());
    }
    Ok(dir)
}

// ---- LibreOffice ----------------------------------------------------------------

/// Convert with LibreOffice in the background (its own profile, so it works
/// even while LibreOffice is open), then move the result next to the file.
pub fn office(src: &Path, target: &str, ext: &str, pdf_import: bool, profile_dir: &Path) -> Result<PathBuf, String> {
    let exe = tools::find(Tool::LibreOffice).ok_or("LibreOffice is not installed")?;
    let tmp = std::env::temp_dir().join(format!("deskflow-convert-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let profile = format!("-env:UserInstallation=file:///{}", profile_dir.to_string_lossy().replace('\\', "/"));
    let mut cmd = Command::new(exe);
    cmd.arg("--headless").arg("--norestore").arg(&profile);
    if pdf_import {
        cmd.arg("--infilter=writer_pdf_import");
    }
    cmd.arg("--convert-to").arg(target).arg("--outdir").arg(&tmp).arg(src);
    let out = hide_console(&mut cmd).output().map_err(|e| e.to_string())?;
    let stem = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let produced = tmp.join(format!("{stem}.{ext}"));
    if !produced.exists() {
        let msg = String::from_utf8_lossy(&out.stderr);
        return Err(format!("LibreOffice couldn't convert this file. {}", msg.trim()));
    }
    let dest = unique_output(src, ext, "");
    std::fs::rename(&produced, &dest)
        .or_else(|_| std::fs::copy(&produced, &dest).map(|_| ()))
        .map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&produced);
    Ok(dest)
}

// ---- FFmpeg ---------------------------------------------------------------------

/// Parse "Duration: 00:01:02.34" from FFmpeg's log.
pub fn parse_duration(line: &str) -> Option<f64> {
    let i = line.find("Duration: ")?;
    let t = line[i + 10..].split(',').next()?.trim();
    let mut parts = t.split(':');
    let h: f64 = parts.next()?.parse().ok()?;
    let m: f64 = parts.next()?.parse().ok()?;
    let s: f64 = parts.next()?.parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

pub fn ffmpeg(src: &Path, ext: &str, args: &[&str], progress: Progress) -> Result<PathBuf, String> {
    let exe = tools::find(Tool::Ffmpeg).ok_or("FFmpeg is not installed")?;
    let out = unique_output(src, ext, "");
    let mut child = hide_console(
        Command::new(exe)
            .args(["-hide_banner", "-y", "-i"])
            .arg(src)
            .args(args)
            .args(["-progress", "pipe:1", "-nostats"])
            .arg(&out)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped()),
    )
    .spawn()
    .map_err(|e| e.to_string())?;
    // Duration comes on stderr, progress on stdout.
    let duration = std::sync::Arc::new(std::sync::Mutex::new(None::<f64>));
    let mut stderr = child.stderr.take().unwrap();
    let d2 = duration.clone();
    let err_thread = std::thread::spawn(move || {
        let mut log = String::new();
        let _ = stderr.read_to_string(&mut log);
        if let Some(d) = log.lines().find_map(parse_duration) {
            *d2.lock().unwrap() = Some(d);
        }
        log
    });
    for line in BufReader::new(child.stdout.take().unwrap()).lines().map_while(Result::ok) {
        let us = line.strip_prefix("out_time_us=").or_else(|| line.strip_prefix("out_time_ms="));
        if let (Some(v), Some(total)) = (us.and_then(|v| v.parse::<f64>().ok()), *duration.lock().unwrap()) {
            if total > 0.0 {
                progress((v / 1_000_000.0 / total).clamp(0.0, 1.0));
            }
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let log = err_thread.join().unwrap_or_default();
    if !status.success() {
        let _ = std::fs::remove_file(&out);
        let last = log.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("unknown error");
        return Err(format!("FFmpeg failed: {last}"));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("df-conv-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn png(dir: &Path, name: &str, color: [u8; 3]) -> PathBuf {
        let p = dir.join(name);
        image::RgbImage::from_pixel(40, 30, image::Rgb(color)).save(&p).unwrap();
        p
    }

    #[test]
    fn unique_names_never_overwrite() {
        let d = tmp("uniq");
        let src = d.join("a.png");
        std::fs::write(d.join("a.jpg"), b"x").unwrap();
        assert_eq!(unique_output(&src, "jpg", ""), d.join("a (1).jpg"));
        assert_eq!(unique_output(&src, "pdf", ""), d.join("a.pdf"));
    }

    #[test]
    fn image_formats_and_pdf_round_trip() {
        let d = tmp("img");
        let a = png(&d, "a.png", [255, 0, 0]);
        let b = png(&d, "b.png", [0, 0, 255]);
        let jpg = image_to(&a, "jpg").unwrap();
        assert!(image::open(&jpg).is_ok());
        let webp = image_to(&a, "webp").unwrap();
        assert!(image::open(&webp).is_ok());
        let pdf = images_to_pdf(&[a.clone(), b.clone()], &|_| {}).unwrap();
        assert_eq!(Document::load(&pdf).unwrap().get_pages().len(), 2);
        let pdf2 = images_to_pdf(&[b], &|_| {}).unwrap();
        let merged = merge_pdfs(&[pdf.clone(), pdf2], &|_| {}).unwrap();
        assert_eq!(Document::load(&merged).unwrap().get_pages().len(), 3);
        let small = compress_pdf(&merged).unwrap();
        assert_eq!(Document::load(&small).unwrap().get_pages().len(), 3);
    }

    #[test]
    fn ffmpeg_duration() {
        assert_eq!(parse_duration("  Duration: 00:01:02.50, start: 0.0"), Some(62.5));
        assert_eq!(parse_duration("nothing"), None);
    }
}
