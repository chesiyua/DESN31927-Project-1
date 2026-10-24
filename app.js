/* Reading Atlas — app logic.
 * All data is fetched live from Open Library (https://openlibrary.org).
 * Free API, no key required, CORS enabled. No mocked or invented data anywhere.
 */
(function () {
  "use strict";

  var OL = "https://openlibrary.org";
  var COVERS = "https://covers.openlibrary.org/b/id";
  var FIELDS = "key,title,author_name,cover_i,first_publish_year,language,subject,ratings_average,ratings_count,number_of_pages_median,publisher";
  var PAGE_SIZE = 20;
  var SHELF_SIZE = 18;
  var SHELF_KEY = "readingatlas:shelf:v1";

  /* Regions for the main "browse by language & region" feature.
   * Every query below was verified live against the Open Library search API. */
  var REGIONS = [
    { native: "English",   en: "English",  query: "english literature", blurb: "From Austen to Morrison" },
    { native: "Français",  en: "French",   query: "french literature",  blurb: "De Hugo à Camus" },
    { native: "Deutsch",   en: "German",   query: "german literature",  blurb: "Von Goethe bis Hesse" },
    { native: "Español",   en: "Spanish",  query: "spanish literature", blurb: "De Cervantes a Allende" },
    { native: "日本語",     en: "Japanese", query: "日本文学",            blurb: "川端から村上まで" },
    { native: "中文",       en: "Chinese",  query: "中国文学",            blurb: "从鲁迅到莫言" }
  ];
  var SUBJECTS = [
    { id: "fiction", label: "Fiction" },
    { id: "mystery", label: "Mystery & Crime" },
    { id: "fantasy", label: "Fantasy" },
    { id: "science", label: "Science" },
    { id: "history", label: "History" }
  ];

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function showToast(msg) {
    var t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.hidden = true; }, 3200);
  }
  function fetchJSON(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }
  function coverUrl(id, size) {
    return id ? COVERS + "/" + id + "-" + (size || "M") + ".jpg" : "";
  }
  function descriptionOf(work) {
    var d = work.description;
    if (!d) return "";
    if (typeof d === "string") return d;
    return d.value || "";
  }

  /* normalize the two API shapes into one book object */
  function fromSearchDoc(d) {
    return {
      key: d.key, title: d.title || "Untitled",
      author: (d.author_name || []).join(", "),
      cover: d.cover_i || 0, year: d.first_publish_year || 0,
      pages: d.number_of_pages_median || 0,
      rating: d.ratings_average || 0, ratingsCount: d.ratings_count || 0,
      publisher: (d.publisher || [])[0] || "",
      subjects: (d.subject || []).slice(0, 3)
    };
  }
  function fromSubjectWork(w) {
    return {
      key: w.key, title: w.title || "Untitled",
      author: (w.authors || []).map(function (a) { return a.name; }).join(", "),
      cover: w.cover_id || 0, year: w.first_publish_year || 0
    };
  }

  /* ---------- state ---------- */
  var state = {
    view: "discover",
    region: 0,
    shelf: loadShelf(),
    search: { q: "", lang: "", offset: 0, numFound: 0, books: [] }
  };
  function loadShelf() {
    try { return JSON.parse(localStorage.getItem(SHELF_KEY) || "[]"); } catch (e) { return []; }
  }
  function saveShelf() {
    try { localStorage.setItem(SHELF_KEY, JSON.stringify(state.shelf)); } catch (e) {}
    updateShelfCount();
  }
  function isSaved(key) { return state.shelf.some(function (b) { return b.key === key; }); }
  function toggleSave(book) {
    var i = state.shelf.findIndex(function (b) { return b.key === book.key; });
    if (i >= 0) { state.shelf.splice(i, 1); showToast("Removed from your shelf"); }
    else {
      state.shelf.push({ key: book.key, title: book.title, author: book.author, cover: book.cover, year: book.year });
      showToast("Saved to your shelf ♥");
    }
    saveShelf(); refreshSaveButtons();
    if (state.view === "shelf") renderShelfView();
  }
  function updateShelfCount() { $("shelf-count").textContent = state.shelf.length; }
  function refreshSaveButtons() {
    Array.prototype.forEach.call(document.querySelectorAll(".save-btn"), function (btn) {
      var on = isSaved(btn.getAttribute("data-key"));
      btn.classList.toggle("is-saved", on);
      btn.textContent = on ? "♥" : "♡";
      btn.setAttribute("aria-label", on ? "Remove from shelf" : "Save to shelf");
    });
  }

  /* ---------- shared renderers ---------- */
  function coverHTML(book, size) {
    if (book.cover) {
      return '<img src="' + coverUrl(book.cover, size) + '" alt="Cover of ' + esc(book.title) + '" loading="lazy" />';
    }
    var initial = (book.title || "?").trim().charAt(0).toUpperCase();
    return "";
  }
  function shelfCardHTML(book) {
    var saved = isSaved(book.key);
    var visual = book.cover
      ? '<img src="' + coverUrl(book.cover, "M") + '" alt="Cover of ' + esc(book.title) + '" loading="lazy" />'
      : "";
    return '<div class="book-spine" role="button" tabindex="0" data-key="' + esc(book.key) + '" ' +
      'aria-label="View details for ' + esc(book.title) + '">' +
      '<div class="book-cover' + (book.cover ? "" : " noimg") + '">' + (visual || esc((book.title || "?").trim().charAt(0).toUpperCase())) +
      '<button type="button" class="save-btn' + (saved ? " is-saved" : "") + '" data-key="' + esc(book.key) + '" ' +
      'aria-label="' + (saved ? "Remove from shelf" : "Save to shelf") + '">' + (saved ? "♥" : "♡") + "</button></div>" +
      '<p class="book-title">' + esc(book.title) + "</p>" +
      '<p class="book-author">' + esc(book.author || "Unknown author") + "</p></div>";
  }
  function skeletonSpines(n) {
    var h = "";
    for (var i = 0; i < n; i++) h += '<div class="sk-spine" aria-hidden="true"><div class="sk-cover"></div><div class="sk-line"></div></div>';
    return h;
  }
  function bindSpines(root, getBook) {
    Array.prototype.forEach.call(root.querySelectorAll(".book-spine"), function (el) {
      function open() { openDetail(el.getAttribute("data-key"), getBook(el.getAttribute("data-key"))); }
      el.addEventListener("click", function (e) { if (e.target.closest(".save-btn")) return; open(); });
      el.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
    });
    Array.prototype.forEach.call(root.querySelectorAll(".save-btn"), function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var b = getBook(btn.getAttribute("data-key"));
        if (b) toggleSave(b);
      });
    });
  }

  /* ---------- hero: featured + real stats ---------- */
  function loadHero() {
    var card = $("feature-card");
    card.innerHTML = '<div class="sk-cover" style="width:130px;height:195px" aria-hidden="true"></div>';
    fetchJSON(OL + "/subjects/fiction.json?limit=1").then(function (d) {
      var w = (d.works || [])[0];
      if (!w) throw new Error("empty");
      var book = fromSubjectWork(w);
      card.innerHTML =
        '<img src="' + coverUrl(book.cover, "M") + '" alt="Cover of ' + esc(book.title) + '" />' +
        "<div><h3>" + esc(book.title) + '</h3><p class="by">by ' + esc(book.author || "Unknown author") + '</p>' +
        '<span class="go">Open details →</span></div>';
      card.setAttribute("data-key", book.key);
      card.addEventListener("click", function () { openDetail(book.key, book); });
      if (d.work_count) $("stat-fiction").textContent = Number(d.work_count).toLocaleString("en-US");
    }).catch(function () { card.innerHTML = "<p>Could not load the featured book.</p>"; });
  }

  /* ---------- catalog stats: real work counts per subject ---------- */
  function loadStats() {
    [["mystery", "stat-mystery"], ["fantasy", "stat-fantasy"], ["science", "stat-science"]].forEach(function (pair) {
      fetchJSON(OL + "/subjects/" + pair[0] + ".json?limit=1").then(function (d) {
        if (d.work_count) $(pair[1]).textContent = Number(d.work_count).toLocaleString("en-US");
      }).catch(function () {});
    });
  }

  /* ---------- language / region browser (main focus) ---------- */
  function renderLangTabs() {
    $("lang-tabs").innerHTML = REGIONS.map(function (r, i) {
      return '<button type="button" class="lang-tab" role="tab" data-i="' + i + '" aria-selected="' + (i === state.region) + '">' +
        '<span class="native">' + esc(r.native) + '</span><span class="en">' + esc(r.en) + " · " + esc(r.blurb) + "</span></button>";
    }).join("");
  }
  function loadRegion(i) {
    state.region = i;
    var r = REGIONS[i];
    Array.prototype.forEach.call(document.querySelectorAll(".lang-tab"), function (t) {
      t.setAttribute("aria-selected", t.getAttribute("data-i") == i ? "true" : "false");
    });
    var shelf = $("lang-shelf");
    shelf.innerHTML = skeletonSpines(8);
    $("lang-meta").textContent = "Loading " + r.en + " books…";
    fetchJSON(OL + "/search.json?q=" + encodeURIComponent(r.query) + "&limit=" + SHELF_SIZE + "&fields=" + FIELDS)
      .then(function (d) {
        var books = (d.docs || []).map(fromSearchDoc);
        if (!books.length) {
          shelf.innerHTML = '<div class="empty-state"><span class="empty-icon">📚</span>No books found here yet.</div>';
          $("lang-meta").textContent = "";
          return;
        }
        shelf._books = {};
        books.forEach(function (b) { shelf._books[b.key] = b; });
        shelf.innerHTML = books.map(shelfCardHTML).join("");
        $("lang-meta").innerHTML = "<strong>" + Number(d.numFound || 0).toLocaleString("en-US") + "</strong> " +
          esc(r.en) + " books found — showing " + books.length + " to start";
        bindSpines(shelf, function (k) { return shelf._books[k]; });
      })
      .catch(function () {
        shelf.innerHTML = '<div class="empty-state"><span class="empty-icon">⚠️</span>Could not load books. Check your connection and try again.</div>';
        showToast("Failed to load " + r.en + " books");
      });
  }

  /* ---------- shared shelf-row shell ---------- */
  function buildRowShell(host, title, linkLabel, onLink, prepend) {
    var row = document.createElement("div");
    row.className = "shelf-row";
    row.innerHTML = '<div class="shelf-row-head"><h3>' + esc(title) + "</h3>" +
      (linkLabel ? '<button type="button" class="row-link">' + esc(linkLabel) + "</button>" : "") + "</div>" +
      '<div class="shelf-wrap"><button class="shelf-arrow left" type="button" aria-label="Scroll left">‹</button>' +
      '<div class="book-shelf">' + skeletonSpines(6) + "</div>" +
      '<button class="shelf-arrow right" type="button" aria-label="Scroll right">›</button></div>';
    if (prepend && host.firstChild) host.insertBefore(row, host.firstChild);
    else host.appendChild(row);
    var shelf = row.querySelector(".book-shelf");
    row.querySelector(".left").addEventListener("click", function () { shelf.scrollBy({ left: -shelf.clientWidth * 0.8, behavior: "smooth" }); });
    row.querySelector(".right").addEventListener("click", function () { shelf.scrollBy({ left: shelf.clientWidth * 0.8, behavior: "smooth" }); });
    if (linkLabel) row.querySelector(".row-link").addEventListener("click", onLink);
    return shelf;
  }

  /* ---------- new arrivals (verified: search supports sort=new) ---------- */
  function loadNewArrivals() {
    var shelf = buildRowShell($("subject-shelves"), "New arrivals", "Search newest →", function () {
      runSearch("literature", "");
    }, true);
    fetchJSON(OL + "/search.json?q=literature&sort=new&limit=" + SHELF_SIZE + "&fields=" + FIELDS)
      .then(function (d) {
        var books = (d.docs || []).map(fromSearchDoc);
        shelf._books = {};
        books.forEach(function (b) { shelf._books[b.key] = b; });
        shelf.innerHTML = books.length ? books.map(shelfCardHTML).join("")
          : '<div class="empty-state">No new arrivals right now.</div>';
        bindSpines(shelf, function (k) { return shelf._books[k]; });
      })
      .catch(function () { shelf.innerHTML = '<div class="empty-state"><span class="empty-icon">⚠️</span>Could not load new arrivals.</div>'; });
  }

  /* ---------- author spotlight (verified: /search/authors.json) ---------- */
  var SPOTLIGHT_AUTHORS = ["Haruki Murakami", "Jane Austen", "Agatha Christie", "Gabriel Garcia Marquez",
    "Toni Morrison", "George Orwell", "J.K. Rowling", "Lu Xun"];
  function loadAuthors() {
    var shelf = $("author-shelf");
    shelf.innerHTML = new Array(4).join('<div class="sk-spine" aria-hidden="true"><div class="sk-cover" style="height:120px"></div></div>');
    Promise.all(SPOTLIGHT_AUTHORS.map(function (name) {
      return fetchJSON(OL + "/search/authors.json?q=" + encodeURIComponent(name) + "&limit=1")
        .then(function (d) { return (d.docs || [])[0] || null; })
        .catch(function () { return null; });
    })).then(function (authors) {
      var list = authors.filter(Boolean);
      if (!list.length) { shelf.innerHTML = '<div class="empty-state">Could not load authors.</div>'; return; }
      shelf.innerHTML = list.map(function (a) {
        var initial = (a.name || "?").trim().charAt(0).toUpperCase();
        var facts = [];
        if (a.work_count) facts.push("<strong>" + Number(a.work_count).toLocaleString("en-US") + "</strong> works");
        if (a.birth_date) facts.push("b. " + esc(a.birth_date));
        return '<button type="button" class="author-card" data-name="' + esc(a.name) + '">' +
          '<span class="author-mono" aria-hidden="true">' + esc(initial) + "</span>" +
          '<p class="author-name">' + esc(a.name) + "</p>" +
          (a.top_work ? '<p class="author-top">Known for <em>' + esc(a.top_work) + "</em></p>" : "") +
          (facts.length ? '<p class="author-facts">' + facts.join(" · ") + "</p>" : "") +
          "</button>";
      }).join("");
      Array.prototype.forEach.call(shelf.querySelectorAll(".author-card"), function (c) {
        c.addEventListener("click", function () { runSearch(c.getAttribute("data-name"), ""); });
      });
    });
  }

  /* ---------- subject shelves ---------- */
  function loadShelves() {
    var host = $("subject-shelves");
    host.innerHTML = "";
    SUBJECTS.forEach(function (s) {
      var row = document.createElement("div");
      row.className = "shelf-row";
      row.innerHTML = '<div class="shelf-row-head"><h3>' + esc(s.label) + "</h3>" +
        '<button type="button" class="row-link" data-subject="' + esc(s.id) + '">Search this shelf →</button></div>' +
        '<div class="shelf-wrap"><button class="shelf-arrow left" type="button" aria-label="Scroll left">‹</button>' +
        '<div class="book-shelf" aria-label="' + esc(s.label) + ' books">' + skeletonSpines(6) + "</div>" +
        '<button class="shelf-arrow right" type="button" aria-label="Scroll right">›</button></div>';
      host.appendChild(row);
      var shelf = row.querySelector(".book-shelf");
      row.querySelector(".left").addEventListener("click", function () { shelf.scrollBy({ left: -shelf.clientWidth * 0.8, behavior: "smooth" }); });
      row.querySelector(".right").addEventListener("click", function () { shelf.scrollBy({ left: shelf.clientWidth * 0.8, behavior: "smooth" }); });
      row.querySelector(".row-link").addEventListener("click", function () {
        $("search-input").value = s.label.toLowerCase();
        runSearch(s.label.toLowerCase(), "");
      });
      fetchJSON(OL + "/subjects/" + s.id + ".json?limit=" + SHELF_SIZE).then(function (d) {
        var books = (d.works || []).map(fromSubjectWork);
        shelf._books = {};
        books.forEach(function (b) { shelf._books[b.key] = b; });
        shelf.innerHTML = books.length ? books.map(shelfCardHTML).join("")
          : '<div class="empty-state">No books on this shelf yet.</div>';
        bindSpines(shelf, function (k) { return shelf._books[k]; });
      }).catch(function () {
        shelf.innerHTML = '<div class="empty-state"><span class="empty-icon">⚠️</span>Could not load this shelf.</div>';
      });
    });
  }

  /* ---------- search ---------- */
  function runSearch(q, lang) {
    q = (q || "").trim();
    if (q.length < 3) { showToast("Please enter at least 3 characters"); return; }
    setView("discover");
    state.search = { q: q, lang: lang, offset: 0, numFound: 0, books: [] };
    $("results").hidden = false;
    $("results-heading").textContent = 'Results for "' + q + '"';
    $("results-meta").textContent = "Searching…";
    $("result-list").innerHTML = "";
    $("load-more").hidden = true;
    fetchSearchPage(true);
    document.getElementById("results").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function fetchSearchPage(first) {
    var s = state.search;
    var url = OL + "/search.json?q=" + encodeURIComponent(s.q) + "&limit=" + PAGE_SIZE +
      "&offset=" + s.offset + "&fields=" + FIELDS + (s.lang ? "&language=" + s.lang : "");
    fetchJSON(url).then(function (d) {
      s.numFound = d.numFound || 0;
      var books = (d.docs || []).map(fromSearchDoc);
      s.books = s.books.concat(books);
      s.offset += books.length;
      renderSearchResults();
    }).catch(function () {
      if (first) {
        $("result-list").innerHTML = '<div class="empty-state"><span class="empty-icon">⚠️</span>Search failed. Please try again.</div>';
        $("results-meta").textContent = "";
      }
      showToast("Search failed — please try again");
    });
  }
  function renderSearchResults() {
    var s = state.search;
    var list = $("result-list");
    if (!s.books.length) {
      list.innerHTML = '<div class="empty-state"><span class="empty-icon">📚</span>No books found for "' + esc(s.q) + '". Try another title or author.</div>';
      $("results-meta").textContent = "";
      $("load-more").hidden = true;
      return;
    }
    list.innerHTML = s.books.map(function (b) {
      var saved = isSaved(b.key);
      var thumb = b.cover
        ? '<img src="' + coverUrl(b.cover, "S") + '" alt="" loading="lazy" />'
        : esc((b.title || "?").trim().charAt(0).toUpperCase());
      return '<li class="result-row" data-key="' + esc(b.key) + '" tabindex="0" role="button" aria-label="View details for ' + esc(b.title) + '">' +
        '<div class="result-thumb' + (b.cover ? "" : " noimg") + '">' + thumb + "</div>" +
        "<div><h3 class=\"result-title\">" + esc(b.title) + '</h3><p class="result-author">by ' + esc(b.author || "Unknown author") +
        (b.year ? " · first published " + b.year : "") + "</p>" +
        (function () {
          var f = [];
          if (b.rating) f.push("★ " + b.rating.toFixed(1) +
            (b.ratingsCount ? " (" + Number(b.ratingsCount).toLocaleString("en-US") + ")" : ""));
          if (b.pages) f.push(Number(b.pages).toLocaleString("en-US") + " pages");
          if (b.publisher) f.push(esc(b.publisher));
          return f.length ? '<p class="result-facts">' + f.join(" · ") + "</p>" : "";
        })() +
        '<p class="result-meta">' + esc(b.key) + " · Open Library</p></div>" +
        '<button type="button" class="save-btn row-save' + (saved ? " is-saved" : "") + '" data-key="' + esc(b.key) + '" ' +
        'aria-label="' + (saved ? "Remove from shelf" : "Save to shelf") + '">' + (saved ? "♥" : "♡") + "</button></li>";
    }).join("");
    $("results-meta").textContent = "Showing " + s.books.length + " of " +
      Number(s.numFound).toLocaleString("en-US") + " books · live from Open Library";
    $("load-more").hidden = s.books.length >= s.numFound;
    Array.prototype.forEach.call(list.querySelectorAll(".result-row"), function (row) {
      function open() {
        var b = s.books.find(function (x) { return x.key === row.getAttribute("data-key"); });
        openDetail(row.getAttribute("data-key"), b);
      }
      row.addEventListener("click", function (e) { if (e.target.closest(".save-btn")) return; open(); });
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
    });
    Array.prototype.forEach.call(list.querySelectorAll(".save-btn"), function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var b = s.books.find(function (x) { return x.key === btn.getAttribute("data-key"); });
        if (b) toggleSave(b);
      });
    });
  }

  /* ---------- detail modal ---------- */
  function openDetail(key, seed) {
    var body = $("modal-body");
    body.innerHTML = '<div class="modal-info"><p>Loading book details…</p></div>';
    $("modal-backdrop").hidden = false;
    document.body.style.overflow = "hidden";
    fetchJSON(OL + key + ".json").then(function (w) {
      renderDetail(w, seed || {});
    }).catch(function () {
      body.innerHTML = '<div class="modal-info"><p>Could not load this book. Please try again.</p></div>';
      showToast("Failed to load book details");
    });
  }
  function renderDetail(w, seed) {
    var title = w.title || seed.title || "Untitled";
    var coverId = seed.cover || 0;
    if (!coverId && w.covers && w.covers.length) coverId = w.covers[0];
    var desc = descriptionOf(w);
    var subjects = (w.subjects || []).slice(0, 10);
    var saved = isSaved(w.key || seed.key);
    var key = w.key || seed.key;
    var coverPane = coverId
      ? '<img src="' + coverUrl(coverId, "L") + '" alt="Cover of ' + esc(title) + '" />'
      : '<div class="noimg" aria-hidden="true">' + esc(title.trim().charAt(0).toUpperCase()) + "</div>";
    $("modal-body").innerHTML =
      '<div class="modal-cover-pane">' + coverPane + "</div>" +
      '<div class="modal-info"><h2 id="modal-title">' + esc(title) + "</h2>" +
      '<p class="modal-by">by ' + esc(seed.author || "Unknown author") +
      (seed.year ? " · first published " + seed.year : "") + "</p>" +
      (function () {
        var f = [];
        if (seed.rating) f.push("★ " + Number(seed.rating).toFixed(1) +
          (seed.ratingsCount ? " (" + Number(seed.ratingsCount).toLocaleString("en-US") + " ratings)" : ""));
        if (seed.pages) f.push(Number(seed.pages).toLocaleString("en-US") + " pages");
        if (seed.publisher) f.push(esc(seed.publisher));
        return f.length ? '<p class="modal-subfacts">' + f.join(" · ") + "</p>" : "";
      })() +
      (subjects.length ? '<div class="modal-tags">' + subjects.map(function (t) {
        return '<span class="modal-tag">' + esc(t) + "</span>";
      }).join("") + "</div>" : "") +
      (desc ? '<p class="modal-desc">' + esc(desc) + "</p>"
            : '<p class="modal-desc">No description available for this edition.</p>') +
      '<p class="modal-facts">Catalogue entry <strong>' + esc(key) + "</strong> · data live from Open Library</p>" +
      '<div class="modal-actions">' +
      '<a class="btn btn-outline btn-sm" href="' + OL + key + '" target="_blank" rel="noopener">View on Open Library</a>' +
      '<button class="btn btn-primary btn-sm" id="modal-save" type="button">' + (saved ? "♥ On your shelf" : "♡ Save to my shelf") + "</button>" +
      "</div>" +
      '<div class="modal-section" id="modal-editions"><p class="muted">Loading editions…</p></div>' +
      '<div class="modal-section" id="modal-related"><p class="muted">Finding related books…</p></div>' +
      "</div></div>";
    $("modal-save").addEventListener("click", function () {
      toggleSave({ key: key, title: title, author: seed.author || "", cover: coverId, year: seed.year || 0 });
      $("modal-save").textContent = isSaved(key) ? "♥ On your shelf" : "♡ Save to my shelf";
    });
    loadModalExtras(key, subjects);
  }

  /* Editions + "more like this", both from live Open Library data */
  function loadModalExtras(key, subjects) {
    var edBox = $("modal-editions");
    fetchJSON(OL + key + "/editions.json?limit=6").then(function (d) {
      if (!edBox || !document.body.contains(edBox)) return;
      var rows = (d.entries || []).map(function (e) {
        var isbn = (e.isbn_13 || e.isbn_10 || e.isbn || [])[0];
        var meta = [(e.publishers || []).join(", "), e.publish_date, isbn ? "ISBN " + isbn : ""].filter(Boolean).join(" · ");
        return '<div class="edition-row"><span class="ed-title">' + esc(e.title || "Untitled edition") + '</span>' +
          '<span class="ed-meta">' + esc(meta) + "</span></div>";
      }).join("");
      edBox.innerHTML = "<h3>Editions</h3>" +
        (d.size ? '<p class="muted">' + Number(d.size).toLocaleString("en-US") + " editions catalogued — showing " + (d.entries || []).length + "</p>" : "") +
        (rows || '<p class="muted">No edition details available.</p>');
    }).catch(function () { if (edBox && document.body.contains(edBox)) edBox.innerHTML = ""; });

    var relBox = $("modal-related");
    var subject = (subjects || [])[0];
    if (!subject) { if (relBox) relBox.innerHTML = ""; return; }
    fetchJSON(OL + "/search.json?q=" + encodeURIComponent(subject) + "&limit=10&fields=" + FIELDS).then(function (d) {
      if (!relBox || !document.body.contains(relBox)) return;
      var books = (d.docs || []).map(fromSearchDoc).filter(function (b) { return b.key !== key; }).slice(0, 8);
      if (!books.length) { relBox.innerHTML = ""; return; }
      var map = {};
      books.forEach(function (b) { map[b.key] = b; });
      relBox.innerHTML = "<h3>More like this</h3>" +
        '<p class="muted">More books tagged \u201c' + esc(subject) + "\u201d</p>" +
        '<div class="mini-shelf">' + books.map(function (b) {
          var visual = b.cover ? '<img src="' + coverUrl(b.cover, "S") + '" alt="" loading="lazy" />' : "";
          return '<button type="button" class="mini-book" data-key="' + esc(b.key) + '">' +
            '<div class="book-cover' + (b.cover ? "" : " noimg") + '">' + (visual || esc((b.title || "?").trim().charAt(0).toUpperCase())) + "</div>" +
            '<p class="book-title">' + esc(b.title) + "</p></button>";
        }).join("") + "</div>";
      Array.prototype.forEach.call(relBox.querySelectorAll(".mini-book"), function (el) {
        el.addEventListener("click", function () { openDetail(el.getAttribute("data-key"), map[el.getAttribute("data-key")]); });
      });
    }).catch(function () { if (relBox && document.body.contains(relBox)) relBox.innerHTML = ""; });
  }
  function closeModal() { $("modal-backdrop").hidden = true; document.body.style.overflow = ""; }

  /* ---------- surprise me ---------- */
  function surpriseMe() {
    showToast("Picking a book for you…");
    var s = SUBJECTS[Math.floor(Math.random() * SUBJECTS.length)];
    fetchJSON(OL + "/subjects/" + s.id + ".json?limit=100").then(function (d) {
      var works = d.works || [];
      if (!works.length) throw new Error("empty");
      var w = works[Math.floor(Math.random() * works.length)];
      openDetail(w.key, fromSubjectWork(w));
    }).catch(function () { showToast("Could not pick a book — try again"); });
  }

  /* ---------- my shelf view ---------- */
  function renderShelfView() {
    var grid = $("shelf-grid");
    if (!state.shelf.length) {
      grid.innerHTML = '<div class="empty-state"><span class="empty-icon">📚</span>Your shelf is empty. Tap ♡ on any book to keep it here.</div>';
      return;
    }
    var map = {};
    state.shelf.forEach(function (b) { map[b.key] = b; });
    grid.innerHTML = state.shelf.map(shelfCardHTML).join("");
    bindSpines(grid, function (k) { return map[k]; });
  }
  function setView(view) {
    state.view = view;
    Array.prototype.forEach.call(document.querySelectorAll('.nav-link[data-view]'), function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-view") === view);
    });
    $("view-discover").hidden = view !== "discover";
    $("view-shelf").hidden = view !== "shelf";
    $("view-finder").hidden = view !== "finder";
    if (view === "shelf") renderShelfView();
    if (view === "finder") renderWizard();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }


  /* ---------- Find my book: step-by-step guided wizard ---------- */
  var WIZ_LANGS = [
    { label: "English",    native: "English",    code: "eng", query: "english literature",    icon: "🇬🇧" },
    { label: "French",     native: "Français",   code: "fre", query: "french literature",     icon: "🇫🇷" },
    { label: "German",     native: "Deutsch",    code: "ger", query: "german literature",     icon: "🇩🇪" },
    { label: "Spanish",    native: "Español",    code: "spa", query: "spanish literature",    icon: "🇪🇸" },
    { label: "Italian",    native: "Italiano",   code: "ita", query: "italian literature",    icon: "🇮🇹" },
    { label: "Portuguese", native: "Português",  code: "por", query: "portuguese literature",  icon: "🇵🇹" },
    { label: "Russian",    native: "Русский",    code: "rus", query: "russian literature",    icon: "🇷🇺" },
    { label: "Dutch",      native: "Nederlands", code: "dut", query: "dutch literature",      icon: "🇳🇱" },
    { label: "Swedish",    native: "Svenska",    code: "swe", query: "swedish literature",    icon: "🇸🇪" },
    { label: "Arabic",     native: "العربية",    code: "ara", query: "arabic literature",     icon: "🇸🇦" },
    { label: "Hindi",      native: "हिन्दी",     code: "hin", query: "hindi literature",      icon: "🇮🇳" },
    { label: "Korean",     native: "한국어",      code: "kor", query: "korean literature",     icon: "🇰🇷" },
    { label: "Japanese",   native: "日本語",      code: "jpn", query: "日本文学",               icon: "🇯🇵" },
    { label: "Chinese",    native: "中文",        code: "chi", query: "中国文学",               icon: "🇨🇳" }
  ];
  var WIZ_GENRES = [
    { label: "Fiction",                 desc: "Novels and literary stories",   kw: "novel",               icon: "📖" },
    { label: "Mystery & Crime",         desc: "Detectives, thrillers, whodunits", kw: "mystery detective", icon: "🔍" },
    { label: "Fantasy",                 desc: "Magic, myths, imaginary worlds", kw: "fantasy",            icon: "🐉" },
    { label: "Science Fiction",         desc: "Space, the future, technology", kw: "science fiction",    icon: "🚀" },
    { label: "Romance",                 desc: "Love stories",                  kw: "romance",            icon: "💕" },
    { label: "Horror",                  desc: "Chills and thrills",            kw: "horror",             icon: "👻" },
    { label: "Adventure",               desc: "Journeys and quests",           kw: "adventure",          icon: "🗺️" },
    { label: "Young Adult",             desc: "Teen reads",                    kw: "young adult",        icon: "🎒" },
    { label: "Children's Books",        desc: "For young readers",             kw: "children",           icon: "🧸" },
    { label: "Comics & Graphic Novels", desc: "Visual storytelling",           kw: "comics graphic novel", icon: "💥" },
    { label: "History",                 desc: "The past, retold",              kw: "history",            icon: "🏛️" },
    { label: "Biography & Memoir",      desc: "Real lives, told truly",        kw: "biography memoir",   icon: "👤" },
    { label: "Poetry",                  desc: "Verse and poems",               kw: "poetry",             icon: "🖋️" },
    { label: "Drama & Plays",           desc: "Stage and script",              kw: "drama plays",        icon: "🎭" },
    { label: "Short Stories",           desc: "Brief fiction",                 kw: "short stories",      icon: "📝" },
    { label: "Essays",                  desc: "Nonfiction musings",            kw: "essays",             icon: "✍️" },
    { label: "Philosophy",              desc: "Big questions",                 kw: "philosophy",         icon: "🤔" },
    { label: "Science",                 desc: "Ideas and the natural world",   kw: "science",            icon: "🔬" },
    { label: "Travel",                  desc: "See the world",                 kw: "travel",             icon: "✈️" },
    { label: "Art",                     desc: "Visual arts",                   kw: "art",                icon: "🎨" }
  ];
  var WIZ_MOODS = [
    { label: "Fresh picks",       desc: "The newest additions to the catalog",   icon: "🆕", sort: "new",    extra: "" },
    { label: "Top rated",         desc: "The highest reader ratings",           icon: "🌟", sort: "rating", extra: "" },
    { label: "Reader favorites",  desc: "The best-matched, most relevant books", icon: "⭐", sort: "",       extra: "" },
    { label: "Timeless classics", desc: "Books that stood the test of time",   icon: "📜", sort: "",       extra: "classic" },
    { label: "Award winners",     desc: "Prize-winning books",                 icon: "🏆", sort: "",       extra: "award" }
  ];
  var WIZ_LENGTHS = [
    { label: "Under 100 pages", desc: "Quick reads",          icon: "⚡", range: "1 TO 99" },
    { label: "100–200 pages",   desc: "A weekend read",       icon: "☕", range: "100 TO 200" },
    { label: "200–400 pages",   desc: "A solid read",         icon: "📖", range: "200 TO 400" },
    { label: "400–700 pages",   desc: "A long epic",          icon: "📚", range: "401 TO 700" },
    { label: "700+ pages",      desc: "Doorstoppers",         icon: "🏛️", range: "701 TO *" },
    { label: "Any length",      desc: "No preference",        icon: "🤷", range: null }
  ];
  var WIZ_ERAS = [
    { label: "2020s",        desc: "Published in 2020 or later", icon: "🆕", range: "2020 TO *" },
    { label: "2000s–2010s",  desc: "Published 2000–2019",        icon: "📱", range: "2000 TO 2019" },
    { label: "20th century", desc: "Published 1900–1999",        icon: "🕰️", range: "1900 TO 1999" },
    { label: "19th century", desc: "Published 1800–1899",        icon: "🎩", range: "1800 TO 1899" },
    { label: "Before 1800",  desc: "Earlier classics",           icon: "📜", range: "* TO 1799" },
    { label: "Any era",      desc: "No preference",              icon: "🤷", range: null }
  ];
  var WIZ_ACCESS = [
    { label: "Readable right now", desc: "Full text available to read online", icon: "📖", ft: true },
    { label: "Show everything",    desc: "Include books without online text",  icon: "🌐", ft: false }
  ];
  var WIZ_STEPS = ["Language", "Genre", "Mood", "Length", "Era", "Access"];
  var WIZ = { step: 0, lang: -1, genre: -1, mood: -1, len: -1, era: -1, access: -1, started: false };

  function wizOptionHTML(kind, opt, i) {
    var sub = (opt.native && opt.native !== opt.label)
      ? '<span class="wiz-opt-sub">' + esc(opt.native) + "</span>"
      : '<span class="wiz-opt-sub">' + esc(opt.desc || "") + "</span>";
    return '<button class="wiz-option" data-kind="' + kind + '" data-i="' + i + '" type="button">' +
      '<span class="wiz-opt-icon" aria-hidden="true">' + opt.icon + "</span>" +
      '<span class="wiz-opt-label">' + esc(opt.label) + "</span>" + sub + "</button>";
  }
  function renderWizard(focusQ) {
    $("wiz-steps").innerHTML = WIZ_STEPS.map(function (s, i) {
      var cls = i < WIZ.step ? "done" : (i === WIZ.step ? "active" : "");
      return '<li class="' + cls + '"><span class="wiz-dot">' + (i < WIZ.step ? "✓" : (i + 1)) + "</span>" + s + "</li>";
    }).join("");
    $("wiz-back").hidden = WIZ.step === 0;
    $("wiz-restart").hidden = !WIZ.started;
    var panel = $("wiz-panel");
    if (WIZ.step === 0) {
      panel.innerHTML = '<p class="wiz-question" tabindex="-1">Which language should your book be in?</p><div class="wiz-options">' +
        WIZ_LANGS.map(function (o, i) { return wizOptionHTML("lang", o, i); }).join("") + "</div>";
    } else if (WIZ.step === 1) {
      panel.innerHTML = '<p class="wiz-question" tabindex="-1">What kind of story are you after?</p><div class="wiz-options">' +
        WIZ_GENRES.map(function (o, i) { return wizOptionHTML("genre", o, i); }).join("") + "</div>";
    } else if (WIZ.step === 2) {
      panel.innerHTML = '<p class="wiz-question" tabindex="-1">What are you in the mood for?</p><div class="wiz-options">' +
        WIZ_MOODS.map(function (o, i) { return wizOptionHTML("mood", o, i); }).join("") + "</div>";
    } else if (WIZ.step === 3) {
      panel.innerHTML = '<p class="wiz-question" tabindex="-1">How long should it be?</p><div class="wiz-options">' +
        WIZ_LENGTHS.map(function (o, i) { return wizOptionHTML("len", o, i); }).join("") + "</div>";
    } else if (WIZ.step === 4) {
      panel.innerHTML = '<p class="wiz-question" tabindex="-1">Which era should it come from?</p><div class="wiz-options">' +
        WIZ_ERAS.map(function (o, i) { return wizOptionHTML("era", o, i); }).join("") + "</div>";
    } else if (WIZ.step === 5) {
      panel.innerHTML = '<p class="wiz-question" tabindex="-1">One last thing — availability?</p><div class="wiz-options">' +
        WIZ_ACCESS.map(function (o, i) { return wizOptionHTML("access", o, i); }).join("") + "</div>";
    } else {
      var L = WIZ_LANGS[WIZ.lang], G = WIZ_GENRES[WIZ.genre], M = WIZ_MOODS[WIZ.mood],
          N = WIZ_LENGTHS[WIZ.len], E = WIZ_ERAS[WIZ.era], A = WIZ_ACCESS[WIZ.access];
      panel.innerHTML = '<p class="wiz-question" tabindex="-1">Your picks</p><p class="wiz-summary"><strong>' + esc(L.label) +
        "</strong> · <strong>" + esc(G.label) + "</strong> · <strong>" + esc(M.label) + "</strong> · <strong>" + esc(N.label) +
        "</strong> · <strong>" + esc(E.label) + "</strong> · <strong>" + esc(A.label) + "</strong></p>";
    }
    Array.prototype.forEach.call(panel.querySelectorAll(".wiz-option"), function (btn) {
      btn.addEventListener("click", function () { wizChoose(btn.getAttribute("data-kind"), parseInt(btn.getAttribute("data-i"), 10)); });
    });
    var optsBox = panel.querySelector(".wiz-options");
    if (optsBox && optsBox.children.length > 8) optsBox.classList.add("dense");
    if (focusQ) {
      var q = panel.querySelector(".wiz-question");
      if (q) q.focus();
    }
  }
  function wizChoose(kind, i) {
    WIZ[kind] = i; WIZ.started = true;
    if (kind === "access") { WIZ.step = 6; renderWizard(true); runWizardSearch(); }
    else { WIZ.step++; renderWizard(true); }
  }
  function wizBack() {
    if (WIZ.step === 6) { $("wiz-results").innerHTML = ""; }
    if (WIZ.step > 0) { WIZ.step--; renderWizard(true); }
  }
  function wizRestart() {
    WIZ.step = 0; WIZ.lang = -1; WIZ.genre = -1; WIZ.mood = -1; WIZ.len = -1; WIZ.era = -1; WIZ.access = -1; WIZ.started = false;
    $("wiz-results").innerHTML = "";
    renderWizard(true);
  }
  var WIZ_PAGE = 24;
  var WIZR = { docs: [], byKey: {}, offset: 0, numFound: 0, sort: "", sortChosen: false, broadened: false, final: null };

  function wizCurrentSort() {
    return WIZR.sortChosen ? WIZR.sort : (WIZ_MOODS[WIZ.mood].sort || "");
  }
  function wizBaseQueries() {
    var L = WIZ_LANGS[WIZ.lang], G = WIZ_GENRES[WIZ.genre], M = WIZ_MOODS[WIZ.mood],
        N = WIZ_LENGTHS[WIZ.len], E = WIZ_ERAS[WIZ.era], A = WIZ_ACCESS[WIZ.access];
    var sort = wizCurrentSort();
    var core = L.query + " " + G.kw + (M.extra ? " " + M.extra : "");
    var lenQ = N.range ? " AND number_of_pages_median:[" + N.range + "]" : "";
    var eraQ = E.range ? " AND first_publish_year:[" + E.range + "]" : "";
    var fullQ = core + lenQ + eraQ;
    var qs = [{ q: fullQ, lang: L.code, sort: sort, ft: A.ft }];
    if (A.ft) qs.push({ q: fullQ, lang: L.code, sort: sort, ft: false });
    if (eraQ) qs.push({ q: core + lenQ, lang: L.code, sort: sort, ft: false });
    if (lenQ) qs.push({ q: core, lang: L.code, sort: sort, ft: false });
    qs.push({ q: L.query + " " + G.kw, lang: L.code, sort: "", ft: false });
    qs.push({ q: L.query, lang: L.code, sort: "", ft: false });
    qs.push({ q: L.query, lang: "", sort: "", ft: false });
    return qs;
  }
  function wizFetch(a, offset) {
    var url = OL + "/search.json?q=" + encodeURIComponent(a.q) + "&limit=" + WIZ_PAGE + "&offset=" + offset +
      "&fields=" + FIELDS + (a.lang ? "&language=" + a.lang : "") + (a.sort ? "&sort=" + a.sort : "") +
      (a.ft ? "&has_fulltext=true" : "");
    return fetchJSON(url);
  }
  function wizAttempt(queries, i) {
    return wizFetch(queries[i], 0).then(function (d) {
      var docs = (d.docs || []).filter(function (x) { return x.key; });
      if (!docs.length && i < queries.length - 1) { WIZR.broadened = true; return wizAttempt(queries, i + 1); }
      WIZR.final = queries[i];
      WIZR.numFound = d.numFound || 0;
      return docs;
    });
  }
  function wizReload() {
    var box = $("wiz-results");
    box.innerHTML = '<div class="wiz-loading"><p>Searching the live catalog…</p></div>';
    WIZR.docs = []; WIZR.byKey = {}; WIZR.offset = 0; WIZR.numFound = 0; WIZR.broadened = false; WIZR.final = null;
    wizAttempt(wizBaseQueries(), 0).then(function (docs) {
      if (!docs.length) {
        box.innerHTML = '<div class="empty-state"><span class="empty-icon">🔍</span>Nothing matched — try different choices.</div>';
        return;
      }
      wizAppendDocs(docs);
    }).catch(function () {
      box.innerHTML = '<div class="empty-state"><span class="empty-icon">⚠️</span>Search failed. Please try again.</div>';
    });
  }
  function runWizardSearch() {
    WIZR.sortChosen = false; WIZR.sort = "";
    wizNarrowInit();
  }
  /* ---------- Akinator-style narrowing: questions computed from the live candidates ---------- */
  function wizFetchPool(a) {
    var url = OL + "/search.json?q=" + encodeURIComponent(a.q) + "&limit=100&fields=" + FIELDS +
      (a.lang ? "&language=" + a.lang : "") + (a.sort ? "&sort=" + a.sort : "") + (a.ft ? "&has_fulltext=true" : "");
    return fetchJSON(url);
  }
  function wizNarrowInit() {
    var box = $("wiz-results");
    box.innerHTML = '<div class="wiz-loading"><p>Searching the live catalog…</p></div>';
    WIZR.docs = []; WIZR.byKey = {}; WIZR.offset = 0; WIZR.numFound = 0; WIZR.broadened = false; WIZR.final = null;
    WIZR.pool = []; WIZR.narrowed = []; WIZR.asked = {}; WIZR.qCount = 0; WIZR.answers = []; WIZR.currentQ = null;
    var queries = wizBaseQueries(), i = 0;
    function attempt() {
      return wizFetchPool(queries[i]).then(function (d) {
        var docs = (d.docs || []).filter(function (x) { return x.key; });
        if (!docs.length && i < queries.length - 1) { WIZR.broadened = true; i++; return attempt(); }
        WIZR.final = queries[i];
        WIZR.numFound = d.numFound || 0;
        return docs;
      });
    }
    attempt().then(function (docs) {
      if (!docs.length) {
        box.innerHTML = '<div class="empty-state"><span class="empty-icon">🔍</span>Nothing matched — try different choices.</div>';
        return;
      }
      WIZR.pool = docs;
      WIZR.narrowed = docs.slice();
      renderNarrow();
    }).catch(function () {
      box.innerHTML = '<div class="empty-state"><span class="empty-icon">⚠️</span>Search failed. Please try again.</div>';
    });
  }
  function narrowCandidates() {
    var pool = WIZR.narrowed, n = pool.length, out = [];
    function score(yes) { return 1 - Math.abs(0.5 - yes / n); }
    function cleanSubject(s) {
      return s && s.length <= 32 && s.indexOf("/") < 0 && !/[A-Z]{5,}/.test(s);
    }
    var ac = {};
    pool.forEach(function (d) {
      var a = (d.author_name || [])[0];
      if (a) ac[a] = (ac[a] || 0) + 1;
    });
    Object.keys(ac).forEach(function (a) {
      if (ac[a] >= 2 && ac[a] < n && !WIZR.asked["author:" + a]) {
        out.push({ key: "author:" + a, q: "Is it by " + a + "?",
          yes: function (d) { return (d.author_name || []).indexOf(a) >= 0; }, s: score(ac[a]) + 0.05 });
      }
    });
    var sc = {};
    pool.forEach(function (d) {
      (d.subject || []).slice(0, 6).forEach(function (s) { if (cleanSubject(s)) sc[s] = (sc[s] || 0) + 1; });
    });
    Object.keys(sc).forEach(function (s) {
      if (sc[s] >= 3 && sc[s] < n && !WIZR.asked["subject:" + s]) {
        out.push({ key: "subject:" + s, q: "Should it be about \u201c" + s + "\u201d?",
          yes: function (d) { return (d.subject || []).indexOf(s) >= 0; }, s: score(sc[s]) });
      }
    });
    var pages = pool.filter(function (d) { return d.number_of_pages_median > 0; })
      .map(function (d) { return d.number_of_pages_median; }).sort(function (a, b) { return a - b; });
    if (pages.length >= 4 && !WIZR.asked.pages) {
      var med = pages[Math.floor(pages.length / 2)];
      var lo = pool.filter(function (d) { return d.number_of_pages_median > 0 && d.number_of_pages_median < med; }).length;
      if (lo > 0 && lo < n) {
        out.push({ key: "pages", q: "Should it be under " + med + " pages?",
          yes: function (d) { return d.number_of_pages_median > 0 && d.number_of_pages_median < med; }, s: score(lo) });
      }
    }
    var years = pool.filter(function (d) { return d.first_publish_year > 0; })
      .map(function (d) { return d.first_publish_year; }).sort(function (a, b) { return a - b; });
    if (years.length >= 4 && !WIZR.asked.year) {
      var ymed = years[Math.floor(years.length / 2)];
      var before = pool.filter(function (d) { return d.first_publish_year > 0 && d.first_publish_year < ymed; }).length;
      if (before > 0 && before < n) {
        out.push({ key: "year", q: "Was it published before " + ymed + "?",
          yes: function (d) { return d.first_publish_year > 0 && d.first_publish_year < ymed; }, s: score(before) });
      }
    }
    var hi = pool.filter(function (d) { return d.ratings_average >= 4; }).length;
    var rated = pool.filter(function (d) { return d.ratings_average > 0; }).length;
    if (rated >= 3 && hi > 0 && hi < n && !WIZR.asked.rating) {
      out.push({ key: "rating", q: "Should it be highly rated (4\u2605 or more)?",
        yes: function (d) { return d.ratings_average >= 4; }, s: score(hi) });
    }
    out.sort(function (a, b) { return b.s - a.s; });
    return out[0] || null;
  }
  function renderNarrow() {
    var box = $("wiz-results");
    var n = WIZR.narrowed.length;
    if (n <= 3 || WIZR.qCount >= 6) { renderFinalists(); return; }
    var c = narrowCandidates();
    if (!c) { renderFinalists(); return; }
    WIZR.currentQ = c;
    box.innerHTML =
      '<div class="narrow-panel">' +
      '<p class="eyebrow">Narrowing it down</p>' +
      '<p class="narrow-q">' + esc(c.q) + "</p>" +
      '<div class="narrow-answers">' +
      '<button class="btn btn-primary" data-a="yes" type="button">Yes</button>' +
      '<button class="btn btn-outline" data-a="no" type="button">No</button>' +
      '<button class="btn btn-ghost" data-a="skip" type="button">Skip</button></div>' +
      '<p class="narrow-progress">Question ' + (WIZR.qCount + 1) + " · <strong>" + n + "</strong> books remaining</p>" +
      (WIZR.answers.length ? '<button class="btn btn-ghost btn-sm" id="narrow-undo" type="button">\u21a9 Undo last answer</button>' : "") +
      "</div>";
    Array.prototype.forEach.call(box.querySelectorAll(".narrow-answers .btn"), function (btn) {
      btn.addEventListener("click", function () { answerNarrow(btn.getAttribute("data-a")); });
    });
    var undo = $("narrow-undo");
    if (undo) undo.addEventListener("click", narrowUndo);
  }
  function answerNarrow(a) {
    var c = WIZR.currentQ;
    if (!c) return;
    WIZR.asked[c.key] = true;
    WIZR.qCount++;
    if (a !== "skip") {
      var prev = WIZR.narrowed;
      var next = prev.filter(function (d) { return a === "yes" ? c.yes(d) : !c.yes(d); });
      if (!next.length) {
        showToast("No books match that — let's try another question");
        renderNarrow();
        return;
      }
      WIZR.answers.push({ q: c, prev: prev });
      WIZR.narrowed = next;
    }
    renderNarrow();
  }
  function narrowUndo() {
    var last = WIZR.answers.pop();
    if (!last) return;
    WIZR.narrowed = last.prev;
    delete WIZR.asked[last.q.key];
    WIZR.qCount = Math.max(0, WIZR.qCount - 1);
    renderNarrow();
  }
  function wizChoiceChips() {
    var L = WIZ_LANGS[WIZ.lang], G = WIZ_GENRES[WIZ.genre], M = WIZ_MOODS[WIZ.mood],
        N = WIZ_LENGTHS[WIZ.len], E = WIZ_ERAS[WIZ.era], A = WIZ_ACCESS[WIZ.access];
    return '<div class="wiz-chips"><span class="wiz-chip">' + esc(L.native) + '</span><span class="wiz-chip">' + esc(G.label) +
      '</span><span class="wiz-chip">' + esc(M.label) + '</span><span class="wiz-chip">' + esc(N.label) +
      '</span><span class="wiz-chip">' + esc(E.label) + '</span><span class="wiz-chip">' + esc(A.label) + "</span>" +
      (WIZR.broadened ? '<span class="wiz-note">search broadened a little to find matches</span>' : "") + "</div>";
  }
  function renderFinalists() {
    var box = $("wiz-results");
    var list = WIZR.narrowed.slice(0, 3);
    list.forEach(function (d) { WIZR.byKey[d.key] = d; });
    box.innerHTML =
      '<div class="narrow-done">' +
      '<p class="eyebrow">Done</p>' +
      "<h3>" + (list.length === 1 ? "This is your book!" : "Your top matches!") + "</h3>" +
      (WIZR.qCount ? '<p class="narrow-sub">Narrowed from ' + WIZR.pool.length + " candidates down to " + list.length +
        " in " + WIZR.qCount + (WIZR.qCount === 1 ? " question." : " questions.") + "</p>" : "") +
      wizChoiceChips() +
      (list.length ? '<div class="finder-picks">' + list.map(finderCardHTML).join("") + "</div>"
        : '<div class="empty-state"><span class="empty-icon">🔍</span>Nothing matched — try different choices.</div>') +
      '<div class="narrow-actions">' +
      (WIZR.answers.length ? '<button class="btn btn-ghost" id="narrow-undo2" type="button">\u21a9 Undo last answer</button>' : "") +
      '<button class="btn btn-outline" id="narrow-all" type="button">Show all ' +
      Number(WIZR.numFound).toLocaleString("en-US") + " results</button>" +
      '<button class="btn btn-ghost" id="narrow-restart" type="button">\u21bb Start over</button>' +
      "</div></div>";
    bindFinderCards(box);
    var undo2 = $("narrow-undo2");
    if (undo2) undo2.addEventListener("click", narrowUndo);
    $("narrow-all").addEventListener("click", function () { wizReload(); });
    $("narrow-restart").addEventListener("click", function () { wizRestart(); });
  }
  function wizLoadMore() {
    var btn = $("wiz-more");
    if (!btn || !WIZR.final) return;
    btn.disabled = true; btn.textContent = "Loading…";
    wizFetch(WIZR.final, WIZR.offset).then(function (d) {
      var docs = (d.docs || []).filter(function (x) { return x.key && !WIZR.byKey[x.key]; });
      wizAppendDocs(docs);
    }).catch(function () {
      btn.disabled = false; btn.textContent = "Load more";
      showToast("Could not load more books");
    });
  }
  function wizAppendDocs(docs) {
    docs.forEach(function (d) {
      if (!WIZR.byKey[d.key]) { WIZR.byKey[d.key] = d; WIZR.docs.push(d); }
    });
    WIZR.offset = WIZR.docs.length;
    var box = $("wiz-results");
    var L = WIZ_LANGS[WIZ.lang], G = WIZ_GENRES[WIZ.genre], M = WIZ_MOODS[WIZ.mood],
        N = WIZ_LENGTHS[WIZ.len], E = WIZ_ERAS[WIZ.era], A = WIZ_ACCESS[WIZ.access];
    var sort = wizCurrentSort();
    var sortOpts = [["", "Most relevant"], ["new", "Newest first"], ["old", "Oldest first"], ["rating", "Top rated"]].map(function (o) {
      return '<option value="' + o[0] + '"' + (o[0] === sort ? " selected" : "") + ">" + o[1] + "</option>";
    }).join("");
    var html = '<div class="wiz-results-bar">' +
      '<p class="wiz-count"><strong>' + Number(WIZR.numFound).toLocaleString("en-US") + "</strong> books found</p>" +
      '<label class="wiz-sort">Sort by <select id="wiz-sort" aria-label="Sort results">' + sortOpts + "</select></label></div>" +
      '<div class="wiz-chips"><span class="wiz-chip">' + esc(L.native) + '</span><span class="wiz-chip">' + esc(G.label) +
      '</span><span class="wiz-chip">' + esc(M.label) + '</span><span class="wiz-chip">' + esc(N.label) +
      '</span><span class="wiz-chip">' + esc(E.label) + '</span><span class="wiz-chip">' + esc(A.label) + "</span>" +
      (WIZR.broadened ? '<span class="wiz-note">search broadened a little to find matches</span>' : "") + "</div>" +
      '<div class="finder-picks">' + WIZR.docs.map(finderCardHTML).join("") + "</div>";
    if (WIZR.docs.length < WIZR.numFound) {
      html += '<div class="wiz-more-wrap"><button class="btn btn-outline" id="wiz-more" type="button">Load more (' +
        Number(WIZR.numFound - WIZR.docs.length).toLocaleString("en-US") + " remaining)</button></div>";
    }
    box.innerHTML = html;
    $("wiz-sort").addEventListener("change", function (e) {
      WIZR.sort = e.target.value; WIZR.sortChosen = true;
      wizReload();
    });
    var more = $("wiz-more");
    if (more) more.addEventListener("click", wizLoadMore);
    bindFinderCards(box);
  }
  function finderCardHTML(d) {
    var b = fromSearchDoc(d);
    var authors = (d.author_name || []).slice(0, 2).join(", ");
    var meta = [];
    if (b.rating > 0) meta.push("★ " + b.rating.toFixed(1) +
      (b.ratingsCount ? ' <span class="dim">(' + Number(b.ratingsCount).toLocaleString("en-US") + ")</span>" : ""));
    if (b.pages) meta.push(Number(b.pages).toLocaleString("en-US") + " pages");
    if (b.publisher) meta.push(esc(b.publisher));
    var tags = (b.subjects || []).map(function (t) { return '<span class="mini-tag">' + esc(t) + "</span>"; }).join("");
    var saved = isSaved(b.key);
    return '<article class="finder-pick" data-key="' + b.key + '" tabindex="0" role="button" aria-label="View details of ' +
      esc(b.title) + '">' +
      '<div class="finder-cover-wrap">' +
      (d.cover_i ? '<img class="finder-pick-cover" src="' + coverUrl(d.cover_i, "M") + '" alt="Cover of ' + esc(b.title) + '" loading="lazy" />'
        : '<div class="finder-pick-cover finder-pick-nocover"><span>📖</span></div>') +
      '<button type="button" class="save-btn card-save' + (saved ? " is-saved" : "") + '" data-key="' + esc(b.key) +
      '" aria-label="' + (saved ? "Remove from shelf" : "Save to shelf") + '">' + (saved ? "♥" : "♡") + "</button></div>" +
      '<div class="finder-pick-body"><h3>' + esc(b.title) + "</h3>" +
      '<p class="finder-pick-author">by ' + esc(authors || "Unknown author") + (b.year ? " · " + b.year : "") + "</p>" +
      (meta.length ? '<p class="finder-pick-meta">' + meta.join(" · ") + "</p>" : "") +
      (tags ? '<div class="mini-tags">' + tags + "</div>" : "") +
      "</div></article>";
  }
  function bindFinderCards(box) {
    Array.prototype.forEach.call(box.querySelectorAll(".finder-pick"), function (card) {
      var k = card.getAttribute("data-key");
      var open = function () { openDetail(k, fromSearchDoc(WIZR.byKey[k] || { key: k })); };
      card.addEventListener("click", function (e) { if (e.target.closest(".save-btn")) return; open(); });
      card.addEventListener("keydown", function (e) {
        if (e.target.closest(".save-btn")) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll(".finder-pick .save-btn"), function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var d = WIZR.byKey[btn.getAttribute("data-key")];
        if (d) toggleSave(fromSearchDoc(d));
      });
    });
  }

  /* ---------- init ---------- */
  function init() {
    updateShelfCount();
    loadHero();
    loadStats();
    renderLangTabs();
    loadRegion(0);
    loadShelves();
    loadNewArrivals();
    loadAuthors();

    $("lang-tabs").addEventListener("click", function (e) {
      var t = e.target.closest(".lang-tab");
      if (t) loadRegion(parseInt(t.getAttribute("data-i"), 10));
    });
    $("lang-prev").addEventListener("click", function () {
      var s = $("lang-shelf"); s.scrollBy({ left: -s.clientWidth * 0.8, behavior: "smooth" });
    });
    $("lang-next").addEventListener("click", function () {
      var s = $("lang-shelf"); s.scrollBy({ left: s.clientWidth * 0.8, behavior: "smooth" });
    });
    $("authors-prev").addEventListener("click", function () {
      var s = $("author-shelf"); s.scrollBy({ left: -s.clientWidth * 0.8, behavior: "smooth" });
    });
    $("authors-next").addEventListener("click", function () {
      var s = $("author-shelf"); s.scrollBy({ left: s.clientWidth * 0.8, behavior: "smooth" });
    });
    $("header-search").addEventListener("submit", function (e) {
      e.preventDefault();
      runSearch($("search-input").value, $("search-lang").value);
    });
    $("load-more").addEventListener("click", function () { fetchSearchPage(false); });
    $("clear-search").addEventListener("click", function () {
      $("results").hidden = true;
      $("search-input").value = "";
      document.getElementById("languages").scrollIntoView({ behavior: "smooth" });
    });
    $("surprise-btn").addEventListener("click", surpriseMe);
    $("hero-surprise").addEventListener("click", surpriseMe);
    $("wiz-back").addEventListener("click", wizBack);
    $("wiz-restart").addEventListener("click", wizRestart);
    $("brand-home").addEventListener("click", function (e) { e.preventDefault(); setView("discover"); });
    $("footer-shelf").addEventListener("click", function (e) { e.preventDefault(); setView("shelf"); });
    Array.prototype.forEach.call(document.querySelectorAll('.nav-link[data-view]'), function (b) {
      b.addEventListener("click", function () { setView(b.getAttribute("data-view")); });
    });
    $("modal-close").addEventListener("click", closeModal);
    $("modal-backdrop").addEventListener("click", function (e) {
      if (e.target === $("modal-backdrop")) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !$("modal-backdrop").hidden) closeModal();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
