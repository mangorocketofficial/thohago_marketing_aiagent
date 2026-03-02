import fs from "node:fs/promises";

let pdfParse = null;
let mammoth = null;
let ExcelJs = null;

const MAX_EXTRACT_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_LENGTH = 50_000;

const TEXT_EXTRACTABLE_EXTENSIONS = new Set([".pdf", ".docx", ".txt", ".xlsx", ".csv"]);

/**
 * @param {string} extension
 * @returns {boolean}
 */
export const isTextExtractable = (extension) => TEXT_EXTRACTABLE_EXTENSIONS.has(String(extension ?? "").toLowerCase());

/**
 * @param {string} filePath
 * @param {string} extension
 * @returns {Promise<string | null>}
 */
export const extractText = async (filePath, extension) => {
  const normalizedExtension = String(extension ?? "").toLowerCase();

  try {
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_EXTRACT_SIZE_BYTES) {
      console.warn(
        `[TextExtract] Skipping large file (${(stats.size / 1024 / 1024).toFixed(1)}MB): ${filePath}`
      );
      return null;
    }
  } catch {
    return null;
  }

  try {
    switch (normalizedExtension) {
      case ".txt":
      case ".csv":
        return await extractTextFile(filePath);
      case ".pdf":
        return await extractPdf(filePath);
      case ".docx":
        return await extractDocx(filePath);
      case ".xlsx":
        return await extractXlsx(filePath);
      default:
        return null;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[TextExtract] Failed for ${filePath}: ${message}`);
    return null;
  }
};

/**
 * @param {string} filePath
 * @returns {Promise<string | null>}
 */
const extractTextFile = async (filePath) => {
  const buffer = await fs.readFile(filePath);
  return truncate(buffer.toString("utf8").trim());
};

/**
 * @param {string} filePath
 * @returns {Promise<string | null>}
 */
const extractPdf = async (filePath) => {
  if (!pdfParse) {
    const module = await import("pdf-parse");
    pdfParse = module.default ?? module;
  }

  const buffer = await fs.readFile(filePath);
  const result = await pdfParse(buffer);
  return truncate(String(result?.text ?? "").trim());
};

/**
 * @param {string} filePath
 * @returns {Promise<string | null>}
 */
const extractDocx = async (filePath) => {
  if (!mammoth) {
    const module = await import("mammoth");
    mammoth = module.default ?? module;
  }

  const result = await mammoth.extractRawText({ path: filePath });
  return truncate(String(result?.value ?? "").trim());
};

/**
 * @param {unknown} value
 * @returns {string}
 */
const cellToText = (value) => {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    const row = value;
    if (typeof row.text === "string") {
      return row.text.trim();
    }
    if (Array.isArray(row.richText)) {
      const rich = row.richText
        .map((item) => (typeof item?.text === "string" ? item.text : ""))
        .join("")
        .trim();
      if (rich) {
        return rich;
      }
    }
    if (typeof row.result === "string" || typeof row.result === "number" || typeof row.result === "boolean") {
      return String(row.result).trim();
    }
  }
  return String(value).trim();
};

/**
 * @param {string} filePath
 * @returns {Promise<string | null>}
 */
const extractXlsx = async (filePath) => {
  if (!ExcelJs) {
    const module = await import("exceljs");
    ExcelJs = module.default ?? module;
  }

  const buffer = await fs.readFile(filePath);
  const workbook = new ExcelJs.Workbook();
  await workbook.xlsx.load(buffer);

  const lines = [];
  for (const worksheet of workbook.worksheets) {
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      const cellTexts = values.map((cell) => cellToText(cell)).filter(Boolean);
      if (cellTexts.length > 0) {
        lines.push(cellTexts.join(" | "));
      }
    });
  }

  return truncate(lines.join("\n"));
};

/**
 * @param {string} text
 * @returns {string | null}
 */
const truncate = (text) => {
  if (!text) {
    return null;
  }
  if (text.length <= MAX_EXTRACTED_TEXT_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_EXTRACTED_TEXT_LENGTH)}\n[...truncated]`;
};

