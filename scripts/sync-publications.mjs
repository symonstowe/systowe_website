#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BIB_PATH = path.join(ROOT, "systowe.bib");
const INDEX_PATH = path.join(ROOT, "index.html");
const PDF_DIR = path.join(ROOT, "pdfs");

const CATEGORY_ORDER = ["Publications", "Proceedings", "Patent Applications", "Talks", "Other"];
const TYPE_TO_CATEGORY = {
  article: "Publications",
  inproceedings: "Proceedings",
  patent: "Patent Applications",
  phdthesis: "Publications",
  mastersthesis: "Publications",
  unpublished: "Talks",
};

const DROP_FIELDS = new Set(["file", "langid", "urldate", "shortjournal", "issue"]);

function parseBib(tex) {
  const entries = [];
  let i = 0;

  while (i < tex.length) {
    const at = tex.indexOf("@", i);
    if (at === -1) {
      break;
    }

    i = at + 1;
    while (i < tex.length && /\s/.test(tex[i])) i += 1;
    const typeStart = i;
    while (i < tex.length && /[A-Za-z]/.test(tex[i])) i += 1;
    const type = tex.slice(typeStart, i).toLowerCase();

    while (i < tex.length && /\s/.test(tex[i])) i += 1;
    if (tex[i] !== "{") continue;
    i += 1;

    while (i < tex.length && /\s/.test(tex[i])) i += 1;
    const keyStart = i;
    while (i < tex.length && tex[i] !== ",") i += 1;
    const key = tex.slice(keyStart, i).trim();
    if (tex[i] !== ",") continue;
    i += 1;

    const fields = {};
    let done = false;
    while (i < tex.length && !done) {
      while (i < tex.length && /\s|,/.test(tex[i])) i += 1;
      if (tex[i] === "}") {
        i += 1;
        done = true;
        break;
      }

      const nameStart = i;
      while (i < tex.length && /[A-Za-z0-9_-]/.test(tex[i])) i += 1;
      const name = tex.slice(nameStart, i).toLowerCase();
      while (i < tex.length && /\s/.test(tex[i])) i += 1;
      if (tex[i] !== "=") break;
      i += 1;
      while (i < tex.length && /\s/.test(tex[i])) i += 1;

      const { value, next } = readBibValue(tex, i);
      fields[name] = value.trim();
      i = next;
    }

    entries.push({ type, key, fields });
  }

  return entries;
}

function readBibValue(tex, start) {
  let i = start;
  if (tex[i] === "{") {
    let depth = 0;
    const valueStart = i;
    while (i < tex.length) {
      if (tex[i] === "{") depth += 1;
      else if (tex[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          break;
        }
      }
      i += 1;
    }
    return { value: tex.slice(valueStart, i), next: i };
  }

  if (tex[i] === "\"") {
    i += 1;
    const valueStart = i;
    while (i < tex.length) {
      if (tex[i] === "\"" && tex[i - 1] !== "\\") break;
      i += 1;
    }
    const value = tex.slice(valueStart, i);
    if (tex[i] === "\"") i += 1;
    return { value, next: i };
  }

  const valueStart = i;
  while (i < tex.length && tex[i] !== "," && tex[i] !== "}") i += 1;
  return { value: tex.slice(valueStart, i), next: i };
}

function bibToText(value) {
  if (!value) return "";
  let out = value.trim();
  while (out.startsWith("{") && out.endsWith("}")) {
    out = out.slice(1, -1).trim();
  }
  out = out
    .replace(/[{}]/g, "")
    .replace(/\\&/g, "&")
    .replace(/\\,/g, ",")
    .replace(/\\%/g, "%")
    .replace(/\s+/g, " ")
    .trim();
  return out;
}

function cleanEntries(entries) {
  const cleaned = entries.map((entry) => {
    const fields = {};
    for (const [name, rawValue] of Object.entries(entry.fields)) {
      if (DROP_FIELDS.has(name)) continue;
      const normalized = bibToText(rawValue);
      if (!normalized) continue;
      fields[name] = normalized;
    }
    return { ...entry, fields };
  });

  cleaned.sort((a, b) => {
    const ay = Number(getYear(a)) || 0;
    const by = Number(getYear(b)) || 0;
    if (ay !== by) return by - ay;
    return (a.fields.title || "").localeCompare(b.fields.title || "");
  });

  return cleaned;
}

function getYear(entry) {
  if (entry.fields.year) return entry.fields.year;
  if (entry.fields.date) return entry.fields.date.slice(0, 4);
  return "Unknown";
}

function normalizeAuthorList(authorField) {
  if (!authorField) return "";
  const people = authorField.split(/\s+and\s+/i).map((p) => p.trim()).filter(Boolean);
  const normalized = people.map((person) => {
    let first = "";
    let last = "";
    if (person.includes(",")) {
      [last, first] = person.split(",").map((s) => s.trim());
    } else {
      const tokens = person.split(/\s+/).filter(Boolean);
      if (tokens.length > 1) {
        last = tokens[tokens.length - 1];
        first = tokens.slice(0, -1).join(" ");
      } else {
        first = person;
      }
    }
    const displayName = `${first} ${last}`.trim() || person;
    const isSymonStowe =
      /^stowe$/i.test(last.replace(/[^\p{L}\p{N}.-]/gu, "")) &&
      (/symon/i.test(first) || /^s(\.|$)/i.test(first.trim()));
    const safeName = escapeHtml(displayName);
    return isSymonStowe ? `<strong>${safeName}</strong>` : safeName;
  });
  return normalized.join(", ");
}

function buildVenue(entry) {
  const f = entry.fields;
  if (entry.type === "article") {
    const pieces = [f.journaltitle || f.journal];
    let vol = "";
    if (f.volume) vol += f.volume;
    if (f.number) vol += `(${f.number})`;
    if (vol) pieces.push(vol);
    if (f.pages) pieces.push(f.pages);
    return pieces.filter(Boolean).join(", ");
  }

  if (entry.type === "inproceedings") {
    const pieces = [f.booktitle || f.eventtitle];
    if (f.location) pieces.push(f.location);
    if (f.date) pieces.push(f.date);
    else if (f.year) pieces.push(f.year);
    if (f.pages) pieces.push(`pp. ${f.pages}`);
    return pieces.filter(Boolean).join(", ");
  }

  if (entry.type === "patent") {
    const pieces = [];
    const statusLabel = formatPatentStatus(f.status);
    if (statusLabel) pieces.push(`Status: ${statusLabel}`);
    if (f.number) pieces.push(f.number);
    if (f.location) pieces.push(f.location);
    if (f.date) pieces.push(f.date);
    return pieces.filter(Boolean).join(", ");
  }

  if (entry.type === "phdthesis" || entry.type === "mastersthesis") {
    const pieces = [];
    if (f.school) pieces.push(f.school);
    if (f.advisor) pieces.push(`Supervisor: ${f.advisor}`);
    else if (f.supervisor) pieces.push(`Supervisor: ${f.supervisor}`);
    if (f.year) pieces.push(f.year);
    else if (f.date) pieces.push(f.date);
    return pieces.filter(Boolean).join(", ");
  }

  if (entry.type === "unpublished") {
    return f.note || f.year || "";
  }

  return [f.booktitle || f.journaltitle || f.note || "", f.year || ""].filter(Boolean).join(", ");
}

function formatPatentStatus(status) {
  if (!status) return "";
  const normalized = status.toLowerCase().replace(/[\s-]+/g, "_");
  const STATUS_LABELS = {
    published_application: "Published application",
    granted: "Granted",
    pending: "Pending",
    abandoned: "Abandoned",
  };
  if (STATUS_LABELS[normalized]) return STATUS_LABELS[normalized];
  return normalized
    .split("_")
    .filter(Boolean)
    .map((token) => token[0].toUpperCase() + token.slice(1))
    .join(" ");
}

function buildLinks(entry) {
  const links = [];
  const seen = new Set();
  const pdfPath = path.join(PDF_DIR, `${entry.key}.pdf`);

  const addLink = (label, href) => {
    if (!href || seen.has(href)) return;
    seen.add(href);
    links.push({ label, href });
  };

  const addAssetLink = (label, fieldNames) => {
    for (const fieldName of fieldNames) {
      const raw = entry.fields[fieldName];
      if (!raw) continue;
      if (!looksLikeLink(raw)) continue;
      addLink(label, normalizeLinkTarget(raw));
      return;
    }
  };

  // Journal-style publications: only show a final-draft style asset link.
  if (entry.type === "article") {
    addAssetLink("Final Draft", ["final_draft", "final_draft_url", "paper_pdf", "paper_url", "pdf"]);
    if (links.length === 0 && fs.existsSync(pdfPath)) {
      addLink("Final Draft", `pdfs/${entry.key}.pdf`);
    }
    return links;
  }

  // Thesis entries: final draft plus optional defence presentation.
  if (entry.type === "phdthesis" || entry.type === "mastersthesis") {
    addAssetLink("Final Draft", ["final_draft", "final_draft_url", "paper_pdf", "paper_url", "pdf"]);
    addAssetLink("Presentation", ["presentation_url", "presentation_link", "presentation_pdf", "slides_url", "slides_link", "slides_pdf"]);
    if (links.length === 0 && fs.existsSync(pdfPath)) {
      addLink("Final Draft", `pdfs/${entry.key}.pdf`);
    }
    return links;
  }

  // Conference items: abstract + presentation/poster, depending on availability.
  if (entry.type === "inproceedings") {
    addAssetLink("Abstract", ["abstract_url", "abstract_link", "abstract_pdf", "abstract"]);
    addAssetLink("Presentation", ["presentation_url", "presentation_link", "presentation_pdf", "talk_url", "talk_pdf"]);
    addAssetLink("Poster", ["poster_url", "poster_link", "poster_pdf", "poster"]);
    if (links.length === 0 && fs.existsSync(pdfPath)) {
      addLink("Abstract", `pdfs/${entry.key}.pdf`);
    }
    return links;
  }

  // Invited talks: slides only.
  if (entry.type === "unpublished") {
    addAssetLink("Slides", ["slides_url", "slides_link", "slides_pdf", "slides"]);
    if (links.length === 0 && fs.existsSync(pdfPath)) {
      addLink("Slides", `pdfs/${entry.key}.pdf`);
    }
    return links;
  }

  // Fallback for other entry types.
  const doi = entry.fields.doi;
  const url = entry.fields.url;
  const doiHref = doi ? `https://doi.org/${doi}` : "";
  const isDoiUrl = url ? /doi\.org\//i.test(url) : false;
  if (url) {
    addLink(isDoiUrl ? "DOI" : "Link", url);
  }
  if (url && doiHref && !isDoiUrl) {
    addLink("DOI", doiHref);
  }
  if (fs.existsSync(pdfPath)) {
    addLink("PDF", `pdfs/${entry.key}.pdf`);
  }
  return links;
}

function looksLikeLink(value) {
  const v = String(value).trim();
  return (
    /^https?:\/\//i.test(v) ||
    /^mailto:/i.test(v) ||
    /^\.{0,2}\//.test(v) ||
    /^\//.test(v) ||
    /\.pdf($|[?#])/i.test(v)
  );
}

function normalizeLinkTarget(value) {
  const v = String(value).trim();
  if (/^https?:\/\//i.test(v) || /^mailto:/i.test(v) || /^\.{0,2}\//.test(v) || /^\//.test(v)) {
    return v;
  }
  return `pdfs/${v}`;
}

function generatePublicationHtml(entries) {
  const byYear = new Map();
  for (const entry of entries) {
    const year = getYear(entry);
    const category = TYPE_TO_CATEGORY[entry.type] || "Other";
    if (!byYear.has(year)) byYear.set(year, new Map());
    const byCategory = byYear.get(year);
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(entry);
  }

  const years = [...byYear.keys()].sort((a, b) => Number(b) - Number(a));
  const lines = [];

  for (const year of years) {
    lines.push(`<h3 class="pub_year">${escapeHtml(year)}</h3>`);
    const byCategory = byYear.get(year);
    for (const category of CATEGORY_ORDER) {
      const entriesForCategory = byCategory.get(category);
      if (!entriesForCategory || entriesForCategory.length === 0) continue;
      lines.push(`<h4 class="pub_type">${escapeHtml(category)}</h4>`);

      entriesForCategory.sort((a, b) => (a.fields.title || "").localeCompare(b.fields.title || ""));
      for (const entry of entriesForCategory) {
        const title = entry.fields.title || entry.key;
        const titleLink = entry.fields.url || (entry.fields.doi ? `https://doi.org/${entry.fields.doi}` : "");
        const authors = normalizeAuthorList(entry.fields.author);
        const venue = buildVenue(entry);
        const links = buildLinks(entry);
        const linkHtml = links.map((link) => `<a href="${escapeHtml(link.href)}">[${escapeHtml(link.label)}]</a>`).join(" ");

        lines.push('<ul class="project_blurb">');
        if (titleLink) {
          lines.push(`  <li><a href="${escapeHtml(titleLink)}"><i>${escapeHtml(title)}</i></a></li>`);
        } else {
          lines.push(`  <li><i>${escapeHtml(title)}</i></li>`);
        }
        if (authors) lines.push(`  <li>${authors}</li>`);
        if (venue || linkHtml) lines.push(`  <li>${escapeHtml(venue)} ${linkHtml}</li>`);
        lines.push("</ul>");
      }
    }
  }

  return lines.join("\n");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function writeCleanBib(entries) {
  const chunks = entries.map((entry) => {
    const lines = [`@${entry.type}{${entry.key},`];
    for (const name of Object.keys(entry.fields).sort()) {
      lines.push(`  ${name} = {${entry.fields[name]}},`);
    }
    lines.push("}");
    return lines.join("\n");
  });
  fs.writeFileSync(BIB_PATH, `${chunks.join("\n\n")}\n`, "utf8");
}

function updateIndex(publicationsHtml) {
  const index = fs.readFileSync(INDEX_PATH, "utf8");
  const startMarker = "<!-- PUBS:START -->";
  const endMarker = "<!-- PUBS:END -->";
  const lastUpdatedMarker = "<!-- LAST_UPDATED -->";
  if (!index.includes(startMarker) || !index.includes(endMarker)) {
    throw new Error("Missing publication markers in index.html");
  }
  let updated = index.replace(
    new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`),
    `${startMarker}\n${publicationsHtml}\n        ${endMarker}`
  );
  const buildDate = new Date().toLocaleString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  const updatedText = `Site last updated on: ${buildDate} (UTC)`;
  if (updated.includes(lastUpdatedMarker)) {
    updated = updated.replace(lastUpdatedMarker, updatedText);
  } else if (/Site last updated on:[^<]*/.test(updated)) {
    updated = updated.replace(/Site last updated on:[^<]*/g, updatedText);
  } else {
    throw new Error("Missing last-updated marker in index.html");
  }
  fs.writeFileSync(INDEX_PATH, updated, "utf8");
}

const rawBib = fs.readFileSync(BIB_PATH, "utf8");
const parsed = parseBib(rawBib);
const cleaned = cleanEntries(parsed);
writeCleanBib(cleaned);
const publicationsHtml = generatePublicationHtml(cleaned);
updateIndex(publicationsHtml);
console.log(`Updated ${cleaned.length} BibTeX entries and regenerated publications in index.html`);
