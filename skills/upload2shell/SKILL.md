---
name: upload2shell
description: File upload testing playbook — bypass extension, MIME, and path filters to test for arbitrary file upload, polyglot execution, config injection (.htaccess/.user.ini), and converter flaws (Ghostscript CVE-2026-125396 'Upload2Shell', ImageMagick). Use when a target accepts file uploads (avatars, attachments, media, import) or processes user files server-side.
allowed-tools:
  - http
  - shell
  - file_write
  - read_payloads
  - web_search
  - web_fetch
---

# Upload2Shell / File upload testing playbook

You suspect a target's file-upload functionality can be leveraged for arbitrary file write, execution bypass, or downstream parser exploitation (including the Ghostscript CVE-2026-125396 "Upload2Shell" sandbox escape).

> **Scope & Safety:** Only test authorized targets. Every finding must be backed by a real, reproducible proof-of-concept with non-destructive verification (e.g. benign token reflection, hash output, or safe out-of-band canary). Never install persistent backdoors, webshells, or destructive code on target systems.

Execution rule: Use real endpoints, parameter names, boundary strings, and session cookies from the scoped target before running commands. Never write literal placeholders such as `<TARGET>` or `<SESSION>` to files; if upload parameters are unknown, discover them first or ask once.

## 1. Map the upload surface & execution model

Before crafting probes, identify how the target receives, stores, and serves files:

1. **Endpoint & Form Structure:**
   - Enumerate upload fields (e.g., `avatar`, `file`, `document`, `attachment`, `image`).
   - Check encoding: `multipart/form-data`, JSON with base64 payload, or raw binary stream (`application/octet-stream`).
2. **Storage Location:**
   - Does the uploaded file land in a public webroot directory (e.g., `/uploads/filename.ext`)?
   - Is it stored in a non-web-accessible directory accessed only via a download script (e.g., `/download.php?id=123`)?
   - Is it dispatched to remote cloud storage (AWS S3, Google Cloud Storage, Azure Blob) on an isolated domain?
3. **Naming Behavior:**
   - Does the server preserve the original filename provided in `Content-Disposition`?
   - Does it append random characters or rename entirely to a UUID/hash?
4. **Execution Permissions:**
   - Are executable extensions executed by the web server (e.g., PHP handler active in `/uploads/`)?
   - Is script execution disabled via web server configuration (`php_flag engine off`, `SetHandler none`)?
5. **Downstream Media Processing:**
   - Are uploaded images or documents converted, resized, or thumbnailed server-side by libraries like ImageMagick, Ghostscript, Pillow, or ffmpeg?

## 2. Content-Type and MIME validation bypass

Many servers inspect only the client-provided `Content-Type` header in the multipart body without validating actual file content:

```sh
# Upload probe with a spoofed image MIME type via curl
curl -ksS -X POST "https://TARGET/api/upload" \
  -H "Cookie: $SESSION" \
  -F "file=@probe.php;type=image/png" \
  -w "\nHTTP %{http_code}  time=%{time_total}\n"
```

Use `read_payloads(skill="upload2shell", file="content-types.txt")` to iterate through permitted MIME types:
- `image/jpeg`, `image/png`, `image/gif`
- `application/octet-stream` (often accepted as a fallback)
- `text/plain`

## 3. Extension filtering & naming bypasses

Determine if the server relies on a denylist (blocking `.php`, `.jsp`, `.exe`) or an allowlist:

### Alternate script extensions
Load `read_payloads(skill="upload2shell", file="extensions.txt")` for common platform alternatives:
- **PHP / Apache / Nginx:** `.phtml`, `.php3`, `.php4`, `.php5`, `.php7`, `.phar`, `.inc`, `.pht`
- **ASP.NET / IIS:** `.aspx`, `.ashx`, `.asmx`, `.asp`, `.cer`, `.asa`
- **Java / Tomcat:** `.jsp`, `.jspx`, `.jsw`, `.jsf`
- **ColdFusion:** `.cfm`, `.cfc`

### Case manipulation
On case-insensitive operating systems or misconfigured web servers:
- `.pHp`, `.Php`, `.aSpX`, `.Jsp`

### Double & compound extensions
- **Apache Multiviews / Handler order:** `probe.php.jpg` (if Apache processes `.php` before `.jpg`)
- **Reverse double extension:** `probe.jpg.php` (if filtering checks only the first dot)
- **Compound extensions:** `probe.php.1`, `probe.php.bak`, `probe.php.test`

### Trailing characters & null bytes
- **Trailing dots/spaces (Windows/IIS):** `probe.php.` or `probe.php ` (Windows strips trailing dots and spaces when writing to disk).
- **Null byte injection (legacy runtimes):** `probe.php%00.png` or `probe.php\x00.jpg`
- **IIS semicolon parameter:** `probe.asp;.jpg` (IIS executes as ASP while filter sees `.jpg`).
- **NTFS Alternate Data Streams (Windows):** `probe.asp::$DATA`

## 4. Path traversal via filename

If the server constructs the storage path using the client-controlled `filename` attribute without canonicalization:

```sh
# Probe path traversal to drop a file in a higher-level webroot
curl -ksS -X POST "https://TARGET/api/upload" \
  -H "Cookie: $SESSION" \
  -F 'file=@probe.txt;filename="../../var/www/html/probe.txt"'
```

Variants to test:
- `../probe.txt`
- `..%2f..%2fprobe.txt` (URL encoded)
- `..%252f..%252fprobe.txt` (double encoded)
- `....//....//probe.txt` (filter evasion for naive `../` stripping)
- `..\..\probe.txt` (Windows path separators)

## 5. Web server configuration overrides

If script extensions are strictly blocked, test whether server configuration files can be uploaded to re-enable script execution:

### Apache `.htaccess`
Upload an `.htaccess` file that binds a non-restricted extension (e.g. `.png` or `.txt`) to the PHP engine:

```apache
AddType application/x-httpd-php .png
```
or
```apache
<Files "probe.png">
  SetHandler application/x-httpd-php
</Files>
```
Then upload `probe.png` containing a benign proof probe.

### PHP-FPM `.user.ini`
If PHP-FPM runs with `.user.ini` enabled, upload a `.user.ini` pointing `auto_prepend_file` to an uploaded image:

```ini
auto_prepend_file = probe.png
```

### IIS `web.config`
On IIS servers, uploading a `web.config` in an upload directory can define new script handlers or reconfigure authentication.

## 6. Downstream media parsers (CVE-2026-125396 "Upload2Shell")

When uploaded files are not directly executed as web scripts, they may be processed by server-side libraries (thumbnail generation, format conversion, PDF preview):

### Ghostscript "Upload2Shell" (CVE-2026-125396)
- **Mechanism:** Ghostscript versions prior to `10.08.0` contain a critical use-after-free sandbox escape in the Type 1 font loader procedure (`.putgstringcopy` in `gs_fonts.ps`). When untrusted PostScript or PDF files are processed, an attacker can bypass `-dSAFER` protections.
- **Transitive Attack Surface:** Often triggered without direct Ghostscript endpoints:
  - Applications using **ImageMagick** or PHP's **Imagick** extension to generate previews for uploaded documents.
  - WordPress / CMS media libraries processing PDF/EPS thumbnails.
  - Webmail engines (e.g. Roundcube) processing document attachments.
- **Verification Workflow:**
  1. *Fingerprint backend processing:* Upload a benign `.pdf`, `.ps`, or `.eps` file and observe if backend rendering takes place (check response timing, metadata headers, or server error traces).
  2. *Out-of-band canary probe:* Send an EPS/PostScript file with an embedded DNS/HTTP interaction URL (e.g. via collaborator or canary token) to safely verify that the backend interpreter resolves external references or executes rendering.
  3. *Version verification:* Inspect error responses, banners, or dependency manifests for Ghostscript `< 10.08.0`.

### ImageMagick & SVG processing
- **SVG with embedded scripts:** Test if `.svg` files are served with `image/svg+xml` without `Content-Security-Policy`. An embedded `<script>alert(origin)</script>` leads to Stored XSS.
- **SVG XXE / SSRF:** Test whether SVG image parsers expand external XML entities (`<!ENTITY xxe SYSTEM "...">`).
- **ImageMagick Delegates:** Test whether ImageMagick delegate policies restrict hazardous formats (`PS`, `EPS`, `PDF`, `XPS`, `MSL`, `MVG`).

## 7. Polyglot files & magic bytes

When deep inspection validates magic bytes (e.g. checking that a PNG starts with `\x89PNG\r\n\x1a\n`):

- **GIF Polyglot:** GIF files have simple headers. A file starting with `GIF89a;` followed by script code may pass MIME/magic-byte checks while remaining executable:
  ```
  GIF89a;<?php echo 'lepus-poc-'.(42*42); ?>
  ```
- **Metadata embedding:** Embed probe code into EXIF metadata / comment fields of valid JPEG/PNG images:
  ```sh
  exiftool -Comment='<?php echo "lepus-poc-safe"; ?>' sample.jpg -o polyglot.jpg
  ```

## 8. Confirming impact & reporting

When an upload vector yields proof of execution or configuration override:

1. **Verify non-destructive proof:** Verify with a benign deterministic output (e.g. `md5('target')` or harmless canary reflection). Never leave active shells on disk.
2. **Capture evidence:** Record the exact upload request (including multipart headers) and the subsequent GET request that demonstrates execution or retrieval.
3. **Confirm the finding:**
   Call `confirm_finding`:
   - `title`: "Arbitrary File Upload in <endpoint>" or "Ghostscript RCE (CVE-2026-125396) via Media Upload"
   - `severity`: P1 (Critical) if unauthenticated code execution; P2 (High) if authenticated or restricted execution.
   - `remediation`:
     - Store uploaded files on an isolated domain / CDN or cloud bucket (AWS S3) with `Content-Disposition: attachment` and script execution disabled.
     - Validate against a strict extension allowlist (never a denylist).
     - Rename all uploaded files to non-guessable random UUIDs; do not use client-supplied names in filesystem paths.
     - Re-encode/transcode images through a safe imaging pipeline to strip active code and metadata.
     - For CVE-2026-125396: Upgrade Ghostscript to **10.08.0 or later**. Update ImageMagick's `policy.xml` to disable vulnerable delegates:
       `<policy domain="coder" rights="none" pattern="PS,EPS,PDF,XPS" />`

