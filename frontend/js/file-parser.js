/**
 * AECPT - CLIENT-SIDE FILE PARSER
 * Hỗ trợ đọc & trích xuất nội dung cho Groq AI:
 * - Tài liệu: .docx (Mammoth), .pdf (PDF.js), .xlsx/.xls (SheetJS), .csv, .txt, .md, .json
 * - Hình ảnh: .png, .jpg, .jpeg, .webp (tối ưu kích thước cho Groq Vision >= 32px + thumbnail nhẹ lưu lịch sử)
 */

(() => {
    "use strict";

    const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
    const MAX_CHARS_PER_FILE = 24000;
    const MAX_FILES_PER_MESSAGE = 5;
    const MAX_PDF_PAGES = 50;

    const DOC_TEXT_EXTENSIONS = new Set(["txt", "md", "csv", "json", "log", "yaml", "yml"]);
    const SPREADSHEET_EXTENSIONS = new Set(["xlsx", "xls"]);
    const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
    const SUPPORTED_EXTENSIONS = new Set(["docx", "pdf", ...SPREADSHEET_EXTENSIONS, ...DOC_TEXT_EXTENSIONS, ...IMAGE_EXTENSIONS]);

    const ACCEPT_STRING = ".docx,.pdf,.xlsx,.xls,.csv,.txt,.md,.json,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp";

    const loadedLibraries = {};

    function loadScriptAsync(src) {
        if (loadedLibraries[src]) return loadedLibraries[src];
        loadedLibraries[src] = new Promise((resolve, reject) => {
            if (typeof document === "undefined" || !document.head) {
                return resolve();
            }
            const existing = document.querySelector(`script[src="${src}"]`);
            if (existing) {
                return resolve();
            }
            const script = document.createElement("script");
            script.src = src;
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => {
                delete loadedLibraries[src];
                reject(new Error(`Không thể nạp thư viện xử lý tệp: ${src}`));
            };
            document.head.appendChild(script);
        });
        return loadedLibraries[src];
    }

    function getExtension(fileName = "", mimeType = "") {
        const clean = String(fileName || "").trim();
        const dotIdx = clean.lastIndexOf(".");
        if (dotIdx > 0 && dotIdx < clean.length - 1) {
            return clean.slice(dotIdx + 1).toLowerCase();
        }
        if (mimeType === "image/png") return "png";
        if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
        if (mimeType === "image/webp") return "webp";
        if (mimeType === "application/pdf") return "pdf";
        if (mimeType === "text/csv") return "csv";
        if (mimeType === "text/plain") return "txt";
        if (mimeType === "application/json") return "json";
        return "";
    }

    function formatBytes(bytes) {
        const num = Number(bytes) || 0;
        if (num < 1024) return `${num} B`;
        if (num < 1024 * 1024) return `${Math.max(1, Math.round(num / 1024))} KB`;
        return `${(num / (1024 * 1024)).toFixed(1)} MB`;
    }

    function getVisualMeta(extInput, kind) {
        const ext = String(extInput || "").toLowerCase();
        if (kind === "image" || IMAGE_EXTENSIONS.has(ext)) {
            return { badgeText: "IMG", badgeClass: "badge-image", typeLabel: "Hình ảnh" };
        }
        if (ext === "docx" || ext === "doc") {
            return { badgeText: "W", badgeClass: "badge-word", typeLabel: "Word (.docx)" };
        }
        if (ext === "pdf") {
            return { badgeText: "PDF", badgeClass: "badge-pdf", typeLabel: "PDF" };
        }
        if (ext === "xlsx" || ext === "xls") {
            return { badgeText: "X", badgeClass: "badge-excel", typeLabel: "Excel" };
        }
        if (ext === "csv") {
            return { badgeText: "CSV", badgeClass: "badge-excel", typeLabel: "CSV" };
        }
        if (ext === "json") {
            return { badgeText: "{}", badgeClass: "badge-text", typeLabel: "JSON" };
        }
        if (ext === "md") {
            return { badgeText: "MD", badgeClass: "badge-text", typeLabel: "Markdown" };
        }
        return { badgeText: (ext || "FILE").slice(0, 4).toUpperCase(), badgeClass: "badge-text", typeLabel: "Văn bản" };
    }

    function isSupportedFile(file) {
        if (!file) return false;
        const ext = getExtension(file.name, file.type);
        if (SUPPORTED_EXTENSIONS.has(ext)) return true;
        if (file.type && IMAGE_EXTENSIONS.has(file.type.replace("image/", "").toLowerCase())) return true;
        return false;
    }

    function clampExtractedText(rawText) {
        const normalized = String(rawText || "")
            .replace(/\u0000/g, "")
            .replace(/\r\n/g, "\n")
            .replace(/\n{4,}/g, "\n\n\n")
            .trim();

        if (normalized.length <= MAX_CHARS_PER_FILE) {
            return {
                text: normalized,
                charCount: normalized.length,
                truncated: false
            };
        }

        const sliced = normalized.slice(0, MAX_CHARS_PER_FILE);
        return {
            text: `${sliced}\n\n[... Nội dung tệp dài ${normalized.length.toLocaleString("vi-VN")} ký tự, đã giữ ${MAX_CHARS_PER_FILE.toLocaleString("vi-VN")} ký tự đầu để phù hợp giới hạn AI ...]`,
            charCount: normalized.length,
            truncated: true
        };
    }

    async function extractDocx(arrayBuffer) {
        if (typeof window !== "undefined" && !window.mammoth) {
            await loadScriptAsync("../vendor/mammoth.browser.min.js");
        }
        if (typeof window === "undefined" || !window.mammoth) {
            throw new Error("Thư viện đọc file Word (mammoth) chưa được nạp.");
        }
        const result = await window.mammoth.extractRawText({ arrayBuffer });
        const text = (result?.value || "").trim();
        if (!text) {
            throw new Error("File Word này không có nội dung văn bản (hoặc chỉ chứa hình ảnh).");
        }
        return { text };
    }

    async function extractPdf(arrayBuffer) {
        if (typeof window !== "undefined" && !window.pdfjsLib) {
            await loadScriptAsync("../vendor/pdf.min.js");
        }
        if (typeof window === "undefined" || !window.pdfjsLib) {
            throw new Error("Thư viện đọc file PDF (PDF.js) chưa được nạp.");
        }
        const pdfjs = window.pdfjsLib;
        if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
            pdfjs.GlobalWorkerOptions.workerSrc = "../vendor/pdf.worker.min.js";
        }

        const loadingTask = pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) });
        const pdf = await loadingTask.promise;
        const totalPages = pdf.numPages || 0;
        const pagesToRead = Math.min(totalPages, MAX_PDF_PAGES);

        const chunks = [];
        let totalExtractedChars = 0;

        for (let pageNum = 1; pageNum <= pagesToRead; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            const lines = [];
            let currentLine = [];
            let lastY = null;

            for (const item of textContent.items || []) {
                const str = item.str || "";
                const y = Array.isArray(item.transform) ? Math.round(item.transform[5]) : null;
                if (lastY !== null && y !== null && Math.abs(y - lastY) > 4 && currentLine.length > 0) {
                    lines.push(currentLine.join(" ").replace(/\s+/g, " ").trim());
                    currentLine = [];
                }
                if (str.trim()) {
                    currentLine.push(str);
                }
                if (item.hasEOL && currentLine.length > 0) {
                    lines.push(currentLine.join(" ").replace(/\s+/g, " ").trim());
                    currentLine = [];
                }
                lastY = y;
            }
            if (currentLine.length > 0) {
                lines.push(currentLine.join(" ").replace(/\s+/g, " ").trim());
            }

            const pageText = lines.filter(Boolean).join("\n");
            if (pageText) {
                chunks.push(`[Trang ${pageNum}/${totalPages}]\n${pageText}`);
                totalExtractedChars += pageText.length;
                if (totalExtractedChars > MAX_CHARS_PER_FILE + 2000) {
                    break;
                }
            }
        }

        if (chunks.length === 0) {
            throw new Error("Không trích xuất được chữ từ PDF này (có thể là PDF dạng ảnh scan). Bạn có thể chụp ảnh trang PDF và gửi dưới dạng ảnh.");
        }

        return {
            text: chunks.join("\n\n"),
            pageCount: totalPages
        };
    }

    async function extractExcel(arrayBuffer) {
        if (typeof window !== "undefined" && !window.XLSX) {
            await loadScriptAsync("../vendor/xlsx.full.min.js");
        }
        if (typeof window === "undefined" || !window.XLSX) {
            throw new Error("Thư viện đọc file Excel (SheetJS) chưa được nạp.");
        }
        const workbook = window.XLSX.read(arrayBuffer, { type: "array", cellDates: true });
        const sheetNames = workbook.SheetNames || [];
        if (sheetNames.length === 0) {
            throw new Error("File Excel không có trang tính (sheet) nào.");
        }

        const parts = [];
        for (const name of sheetNames) {
            const sheet = workbook.Sheets[name];
            if (!sheet) continue;
            const csv = window.XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim();
            if (csv) {
                parts.push(`[Sheet: ${name}]\n${csv}`);
            }
        }

        if (parts.length === 0) {
            throw new Error("Các sheet trong file Excel đều đang trống.");
        }

        return {
            text: parts.join("\n\n"),
            sheetNames
        };
    }

    function readAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("Không thể đọc dữ liệu ảnh."));
            reader.readAsDataURL(file);
        });
    }

    async function processImageFile(file) {
        const rawDataUrl = await readAsDataUrl(file);
        if (typeof document === "undefined" || typeof Image === "undefined") {
            return { imageDataUrl: rawDataUrl, thumbnailUrl: rawDataUrl };
        }

        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const srcW = img.naturalWidth || img.width || 64;
                const srcH = img.naturalHeight || img.height || 64;

                // Bảo đảm cạnh tối thiểu >= 32px theo yêu cầu của Groq Vision, tối đa 1280px
                const renderScaled = (maxDim, minDim, quality) => {
                    let targetW = srcW;
                    let targetH = srcH;
                    const maxSide = Math.max(targetW, targetH);
                    if (maxSide > maxDim) {
                        const scale = maxDim / maxSide;
                        targetW = Math.round(targetW * scale);
                        targetH = Math.round(targetH * scale);
                    }
                    const canvas = document.createElement("canvas");
                    const canvasW = Math.max(minDim, targetW);
                    const canvasH = Math.max(minDim, targetH);
                    canvas.width = canvasW;
                    canvas.height = canvasH;
                    const ctx = canvas.getContext("2d");
                    if (!ctx) return rawDataUrl;

                    ctx.fillStyle = "#ffffff";
                    ctx.fillRect(0, 0, canvasW, canvasH);
                    const offsetX = Math.floor((canvasW - targetW) / 2);
                    const offsetY = Math.floor((canvasH - targetH) / 2);
                    ctx.drawImage(img, offsetX, offsetY, targetW, targetH);
                    return canvas.toDataURL("image/jpeg", quality);
                };

                const visionUrl = renderScaled(1280, 32, 0.85);
                const thumbUrl = renderScaled(320, 32, 0.72);
                resolve({ imageDataUrl: visionUrl, thumbnailUrl: thumbUrl });
            };
            img.onerror = () => resolve({ imageDataUrl: rawDataUrl, thumbnailUrl: rawDataUrl });
            img.src = rawDataUrl;
        });
    }

    async function parseFile(file) {
        if (!file) throw new Error("Không tìm thấy tệp.");

        const ext = getExtension(file.name, file.type);
        if (ext === "doc") {
            throw new Error(`Tệp "${file.name}" có định dạng .doc cũ. Vui lòng chuyển sang .docx hoặc .pdf trước khi tải lên.`);
        }
        if (!isSupportedFile(file)) {
            throw new Error(`Định dạng "${file.name}" chưa được hỗ trợ. Hỗ trợ: .docx, .pdf, .xlsx, .xls, .csv, .txt, .md, .json và ảnh (.png, .jpg, .webp).`);
        }
        if (file.size > MAX_FILE_SIZE_BYTES) {
            throw new Error(`Tệp "${file.name}" (${formatBytes(file.size)}) vượt quá giới hạn ${formatBytes(MAX_FILE_SIZE_BYTES)}.`);
        }

        const baseAttachment = {
            id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            name: file.name || `tep_dinh_kem.${ext || "bin"}`,
            size: file.size || 0,
            mimeType: file.type || "",
            ext,
            status: "ready"
        };

        if (IMAGE_EXTENSIONS.has(ext) || (file.type && file.type.startsWith("image/"))) {
            const { imageDataUrl, thumbnailUrl } = await processImageFile(file);
            return {
                ...baseAttachment,
                kind: "image",
                extractedText: "",
                charCount: 0,
                truncated: false,
                imageDataUrl,
                thumbnailUrl
            };
        }

        let extracted = { text: "" };
        if (ext === "docx") {
            const buffer = await file.arrayBuffer();
            extracted = await extractDocx(buffer);
        } else if (ext === "pdf") {
            const buffer = await file.arrayBuffer();
            extracted = await extractPdf(buffer);
        } else if (SPREADSHEET_EXTENSIONS.has(ext)) {
            const buffer = await file.arrayBuffer();
            extracted = await extractExcel(buffer);
        } else {
            const text = typeof file.text === "function"
                ? await file.text()
                : await new Response(file).text();
            if (!String(text || "").trim()) {
                throw new Error(`Tệp "${file.name}" không có nội dung văn bản.`);
            }
            extracted = { text };
        }

        const clamped = clampExtractedText(extracted.text);
        return {
            ...baseAttachment,
            kind: "document",
            extractedText: clamped.text,
            charCount: clamped.charCount,
            truncated: clamped.truncated,
            pageCount: extracted.pageCount || null,
            sheetNames: extracted.sheetNames || null,
            imageDataUrl: null,
            thumbnailUrl: null
        };
    }

    window.FileParser = {
        MAX_FILE_SIZE_BYTES,
        MAX_CHARS_PER_FILE,
        MAX_FILES_PER_MESSAGE,
        ACCEPT_STRING,
        getExtension,
        formatBytes,
        getVisualMeta,
        isSupportedFile,
        parseFile
    };
})();
