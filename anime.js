// === Enhanced anime.js (secure DOM updates, safer URL handling) ===
const apiUrl = "https://api.jikan.moe/v4/seasons/now";
const CACHE_KEY = "jikan_season_now_cache_v1";
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

let currentPage = 1;
let currentData = [];
let filteredData = [];
let recentlyViewed = JSON.parse(localStorage.getItem("recentlyViewed") || "[]");
let favorites = JSON.parse(localStorage.getItem("favorites") || "[]");

// DOM Elements
const animeCards = document.getElementById("anime-cards");
const genreSelect = document.getElementById("genre-select");
const statusSelect = document.getElementById("status-select");
const seasonSelect = document.getElementById("season-select");
const yearSelect = document.getElementById("year-select");
const sortSelect = document.getElementById("sort-select");
const searchInput = document.getElementById("search-input");
const searchButton = document.getElementById("search-button");
const clearFiltersBtn = document.getElementById("clear-filters");
const clearSearchBtn = document.getElementById("clear-search");
const pagination = document.getElementById("pagination");
const resultsInfo = document.getElementById("results-info");
const loadingSpinner = document.getElementById("loading-spinner");
const noResults = document.getElementById("no-results");
const modal = document.getElementById("anime-modal");
const closeModal = document.getElementById("close-modal");

// --- Accessibility upgrades (safe if missing) ---
if (resultsInfo) resultsInfo.setAttribute("aria-live", "polite");
if (modal) {
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "modal-title");
}

let previouslyFocusedEl = null; // for focus restore
let trapFocusHandler = null;

// Utilities
function showLoading() {
  loadingSpinner?.classList.remove("hidden");
  animeCards?.classList.add("hidden");
  noResults?.classList.add("hidden");
}
function hideLoading() {
  loadingSpinner?.classList.add("hidden");
  animeCards?.classList.remove("hidden");
}
function scrollToGridTop() {
  try {
    const top = (animeCards?.offsetTop || 0) - 80;
    window.scrollTo({ top: top < 0 ? 0 : top, behavior: "smooth" });
  } catch {}
}

// Debounce utility
function debounce(fn, delay = 400) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

// Persist filters
function saveFilters() {
  const filters = {
    genre: genreSelect?.value ?? "all",
    status: statusSelect?.value ?? "",
    season: seasonSelect?.value ?? "",
    year: yearSelect?.value ?? "",
    sort: sortSelect?.value ?? "default",
    search: searchInput?.value ?? "",
  };
  localStorage.setItem("filters", JSON.stringify(filters));
}
function loadFilters() {
  const saved = JSON.parse(localStorage.getItem("filters") || "{}");
  if (saved.genre && genreSelect) genreSelect.value = saved.genre;
  if (saved.status && statusSelect) statusSelect.value = saved.status;
  if (saved.season && seasonSelect) seasonSelect.value = saved.season;
  if (saved.year && yearSelect) yearSelect.value = saved.year;
  if (saved.sort && sortSelect) sortSelect.value = saved.sort;
  if (typeof saved.search === "string" && searchInput) searchInput.value = saved.search;
}

// Update results info
function updateResultsInfo() {
  const total = filteredData.length;
  const startIndex = (currentPage - 1) * 9 + 1;
  const endIndex = Math.min(currentPage * 9, total);
  if (total === 0) {
    resultsInfo.textContent = "No anime found";
  } else {
    resultsInfo.textContent = `Showing ${startIndex}-${endIndex} of ${total} anime`;
  }
}

// Modal helpers
function setUpFavButton(anime) {
  const titleEl = document.getElementById("modal-title");
  let favBtn = document.getElementById("modal-fav-btn");
  if (!favBtn && titleEl && titleEl.parentNode) {
    favBtn = document.createElement("button");
    favBtn.id = "modal-fav-btn";
    favBtn.type = "button";
    favBtn.className =
      "ml-3 px-3 py-1 rounded bg-pink-600 hover:bg-pink-700 text-white text-xs font-semibold";
    titleEl.parentNode.insertBefore(favBtn, titleEl.nextSibling);
  }
  if (!favBtn) return; // gracefully skip if cannot place

  const isFav = favorites.some((f) => f.mal_id === anime.mal_id);
  favBtn.textContent = isFav ? "♥ Favorited" : "♡ Favorite";
  favBtn.setAttribute("aria-pressed", String(isFav));
  favBtn.onclick = () => {
    toggleFavorite(anime);
    setUpFavButton(anime);
  };
}

function trapFocus(container) {
  const focusable = container.querySelectorAll(
    'a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])'
  );
  const elements = Array.from(focusable).filter((el) => !el.hasAttribute("disabled"));
  if (!elements.length) return;
  const firstEl = elements[0];
  const lastEl = elements[elements.length - 1];

  trapFocusHandler = (e) => {
    if (e.key !== "Tab") return;
    if (e.shiftKey && document.activeElement === firstEl) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  };
  document.addEventListener("keydown", trapFocusHandler);
  firstEl.focus();
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function safeSetHref(el, href) {
  if (!el) return;
  if (isValidUrl(href)) {
    el.href = href;
    el.target = "_blank";
    el.rel = "noopener noreferrer";
  } else {
    el.href = "#";
    el.removeAttribute("target");
    el.removeAttribute("rel");
  }
}

function openModal(anime) {
  addToRecentlyViewed(anime);

  document.getElementById("modal-title").textContent = anime.title || "Untitled";
  document.getElementById("modal-title-english").textContent =
    anime.title_english || anime.title_synonyms?.[0] || "";
  document.getElementById("modal-synopsis").textContent =
    anime.synopsis || "No synopsis available.";

  const imgEl = document.getElementById("modal-image");
  const imageUrl = anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || "";
  if (isValidUrl(imageUrl)) {
    imgEl.src = imageUrl;
  } else {
    imgEl.removeAttribute("src");
  }
  imgEl.alt = anime.title || "Anime poster";

  document.getElementById("modal-episodes").textContent = anime.episodes || "N/A";
  document.getElementById("modal-score").textContent = anime.score ? `${anime.score}/10` : "N/A";
  document.getElementById("modal-status").textContent = anime.status || "N/A";
  document.getElementById("modal-duration").textContent = anime.duration || "N/A";
  document.getElementById("modal-rating").textContent = anime.rating || "N/A";

  const airedText = anime.aired?.string || (anime.year ? `${anime.year}` : "N/A");
  document.getElementById("modal-aired").textContent = airedText;

  const genresContainer = document.getElementById("modal-genres");
  genresContainer.innerHTML = ""; // safe to clear existing
  if (Array.isArray(anime.genres) && anime.genres.length) {
    anime.genres.forEach((genre) => {
      const genreTag = document.createElement("span");
      genreTag.className = "bg-blue-600 text-white px-3 py-1 rounded-full text-xs";
      genreTag.textContent = genre.name || "Unknown";
      genresContainer.appendChild(genreTag);
    });
  } else {
    const span = document.createElement("span");
    span.className = "text-zinc-400";
    span.textContent = "No genres available";
    genresContainer.appendChild(span);
  }

  const studiosContainer = document.getElementById("modal-studios");
  studiosContainer.textContent = Array.isArray(anime.studios) && anime.studios.length
    ? anime.studios.map((s) => s.name).join(", ")
    : "No studio info";

  const producersContainer = document.getElementById("modal-producers");
  producersContainer.textContent = Array.isArray(anime.producers) && anime.producers.length
    ? anime.producers.slice(0, 3).map((p) => p.name).join(", ")
    : "No producer info";

  // External Links (safe)
  const malLink = document.getElementById("modal-mal-link");
  safeSetHref(malLink, anime.url || "");

  const trailerLink = document.getElementById("modal-trailer-link");
  if (anime.trailer?.url && isValidUrl(anime.trailer.url)) {
    safeSetHref(trailerLink, anime.trailer.url);
    trailerLink.classList.remove("hidden");
  } else if (trailerLink) {
    trailerLink.classList.add("hidden");
  }

  // Favorites button
  setUpFavButton(anime);

  // Show modal + focus trap
  previouslyFocusedEl = document.activeElement;
  modal.classList.remove("hidden");
  modal.style.display = "flex";
  setTimeout(() => {
    modal.querySelector("div")?.classList.add("animate-modalOpen");
  }, 10);
  document.body.style.overflow = "hidden";

  const content = modal.querySelector("div");
  if (content) trapFocus(content);
}

function closeModalFn() {
  modal.querySelector("div")?.classList.remove("animate-modalOpen");
  setTimeout(() => {
    modal.classList.add("hidden");
    modal.style.display = "none";
    document.body.style.overflow = "auto";
    if (trapFocusHandler) document.removeEventListener("keydown", trapFocusHandler);
    trapFocusHandler = null;
    previouslyFocusedEl?.focus?.();
  }, 300);
}

// Favorites
function toggleFavorite(anime) {
  const exists = favorites.some((f) => f.mal_id === anime.mal_id);
  if (exists) {
    favorites = favorites.filter((f) => f.mal_id !== anime.mal_id);
  } else {
    favorites.push({
      mal_id: anime.mal_id,
      title: anime.title,
      image: anime.images?.webp?.large_image_url || anime.images?.jpg?.large_image_url,
      score: anime.score,
    });
  }
  localStorage.setItem("favorites", JSON.stringify(favorites));
}

// Recently viewed
function addToRecentlyViewed(anime) {
  recentlyViewed = recentlyViewed.filter((item) => item.mal_id !== anime.mal_id);
  recentlyViewed.unshift({
    mal_id: anime.mal_id,
    title: anime.title,
    image: anime.images?.webp?.large_image_url || anime.images?.jpg?.large_image_url,
    score: anime.score,
  });
  recentlyViewed = recentlyViewed.slice(0, 10);
  localStorage.setItem("recentlyViewed", JSON.stringify(recentlyViewed));
  renderRecentlyViewed();
}

function renderRecentlyViewed() {
  const container = document.getElementById("recently-viewed");
  const section = document.getElementById("recently-viewed-section");
  if (!container || !section) return;

  if (recentlyViewed.length === 0) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");
  container.innerHTML = "";

  recentlyViewed.forEach((anime) => {
    const card = document.createElement("div");
    card.className =
      "flex-shrink-0 bg-zinc-800 rounded-lg p-2 cursor-pointer hover:bg-zinc-700 transition-colors w-32";

    const img = document.createElement("img");
    img.src = anime.image || "";
    img.alt = anime.title || "Poster";
    img.loading = "lazy";
    img.className = "w-full h-20 object-cover rounded mb-2";

    const title = document.createElement("p");
    title.className = "text-xs text-white font-medium truncate";
    title.textContent = anime.title;

    const score = document.createElement("p");
    score.className = "text-xs text-zinc-400";
    score.textContent = anime.score ? `⭐ ${anime.score}` : "No score";

    card.appendChild(img);
    card.appendChild(title);
    card.appendChild(score);

    card.addEventListener("click", () => {
      const fullAnime = currentData.find((a) => a.mal_id === anime.mal_id);
      if (fullAnime) openModal(fullAnime);
    });
    container.appendChild(card);
  });
}

// Fetch with timeout + session cache
async function fetchAnime() {
  try {
    showLoading();

    // session cache
    const cachedRaw = sessionStorage.getItem(CACHE_KEY);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      if (Date.now() - cached.time < CACHE_TTL && Array.isArray(cached.data)) {
        currentData = cached.data;
        applyFilters();
        renderRecentlyViewed();
        hideLoading();
        return;
      }
    }

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12000); // 12s timeout

    const response = await fetch(apiUrl, { signal: controller.signal });
    clearTimeout(t);

    if (!response.ok) throw new Error("Network response was not ok");
    const data = await response.json();
    currentData = data.data || [];

    // save cache
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ time: Date.now(), data: currentData })
    );

    applyFilters();
    renderRecentlyViewed();
  } catch (error) {
    hideLoading();
    // Build a safe error UI without innerHTML
    if (animeCards) {
      animeCards.innerHTML = "";
      const container = document.createElement("div");
      container.className = "text-center py-10 text-zinc-300";

      const msg = document.createElement("p");
      msg.className = "text-red-500 mb-4";
      msg.textContent = `⚠️ Failed to load anime data. ${error?.name === "AbortError" ? "Request timed out." : "Please try again."}`;

      const retryBtn = document.createElement("button");
      retryBtn.id = "retry-fetch";
      retryBtn.className = "px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600";
      retryBtn.textContent = "Retry";
      retryBtn.addEventListener("click", fetchAnime);

      container.appendChild(msg);
      container.appendChild(retryBtn);
      animeCards.appendChild(container);
    }
  } finally {
    hideLoading();
  }
}

// Filters + sort + search
function applyFilters() {
  const selectedGenre = genreSelect?.value ?? "all";
  const selectedStatus = statusSelect?.value ?? "";
  const selectedSeason = seasonSelect?.value ?? "";
  const selectedYear = yearSelect?.value ?? "";
  const selectedSort = sortSelect?.value ?? "default";
  const searchText = (searchInput?.value || "").toLowerCase();

  filteredData = (currentData || []).filter((anime) => {
    const matchesGenre =
      selectedGenre === "all" || (anime.genres || []).some((g) => g.mal_id == selectedGenre);

    const matchesStatus =
      selectedStatus === "" ||
      (selectedStatus === "airing" && anime.airing) ||
      (selectedStatus === "upcoming" && anime.status === "Not yet aired") ||
      (selectedStatus === "completed" && anime.status === "Finished Airing");

    const matchesSeason = selectedSeason === "" || anime.season === selectedSeason;
    const matchesYear = selectedYear === "" || anime.year == selectedYear;

    const title = (anime.title || "").toLowerCase();
    const titleEn = (anime.title_english || "").toLowerCase();
    const matchesSearch = title.includes(searchText) || titleEn.includes(searchText);

    return matchesGenre && matchesStatus && matchesSeason && matchesYear && matchesSearch;
  });

  if (selectedSort !== "default") {
    filteredData.sort((a, b) => {
      switch (selectedSort) {
        case "title":
          return (a.title || "").localeCompare(b.title || "");
        case "score":
          return (b.score || 0) - (a.score || 0);
        case "episodes":
          return (b.episodes || 0) - (a.episodes || 0);
        case "year":
          return (b.year || 0) - (a.year || 0);
        default:
          return 0;
      }
    });
  }

  hideLoading();
  renderAnime();
  renderPagination();
  updateResultsInfo();
  saveFilters();
}

function renderAnime() {
  if (!animeCards) return;
  animeCards.innerHTML = "";
  const startIndex = (currentPage - 1) * 9;
  const pageData = filteredData.slice(startIndex, startIndex + 9);

  if (pageData.length === 0) {
    noResults?.classList.remove("hidden");
    animeCards?.classList.add("hidden");
    return;
  }

  noResults?.classList.add("hidden");
  animeCards?.classList.remove("hidden");

  pageData.forEach((anime) => {
    const card = document.createElement("div");
    card.className =
      "bg-zinc-800 p-4 rounded-xl shadow-lg hover:shadow-blue-400 hover:scale-105 transition-all duration-300 cursor-pointer relative";

    // Image wrapper
    const imgWrapper = document.createElement("div");
    imgWrapper.className = "relative";

    const img = document.createElement("img");
    img.src = anime.images?.webp?.large_image_url || anime.images?.jpg?.large_image_url || "";
    img.alt = anime.title || "Poster";
    img.loading = "lazy";
    img.className = "w-full h-60 object-cover rounded mb-3 transition-opacity duration-300";
    img.style.opacity = "0";
    img.addEventListener("load", () => { img.style.opacity = "1"; });

    const scoreBadge = document.createElement("div");
    scoreBadge.className = "absolute top-2 right-2 bg-black bg-opacity-70 text-white px-2 py-1 rounded text-xs";
    scoreBadge.textContent = anime.score ? `⭐ ${anime.score}` : "No score";

    imgWrapper.appendChild(img);
    imgWrapper.appendChild(scoreBadge);

    const titleEl = document.createElement("h3");
    titleEl.className = "text-lg font-bold text-blue-400 mb-1 line-clamp-2";
    titleEl.textContent = anime.title || "Untitled";

    const eps = document.createElement("p");
    eps.className = "text-sm text-zinc-400";
    eps.textContent = `Episodes: ${anime.episodes ?? "N/A"}`;

    const status = document.createElement("p");
    status.className = "text-sm text-zinc-400";
    status.textContent = `Status: ${anime.status || "N/A"}`;

    card.appendChild(imgWrapper);
    card.appendChild(titleEl);
    card.appendChild(eps);
    card.appendChild(status);

    card.addEventListener("click", () => openModal(anime));
    animeCards.appendChild(card);
  });
}

function renderPagination() {
  if (!pagination) return;
  pagination.innerHTML = "";
  const totalPages = Math.ceil(filteredData.length / 9);
  if (totalPages <= 1) return;

  if (currentPage > 1) {
    const prevBtn = document.createElement("button");
    prevBtn.textContent = "← Previous";
    prevBtn.className =
      "px-4 py-2 bg-zinc-700 text-zinc-300 hover:bg-blue-400 rounded-md transition-colors";
    prevBtn.addEventListener("click", () => {
      currentPage--;
      renderAnime();
      renderPagination();
      updateResultsInfo();
      scrollToGridTop();
    });
    pagination.appendChild(prevBtn);
  }

  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, startPage + 4);

  for (let i = startPage; i <= endPage; i++) {
    const btn = document.createElement("button");
    btn.textContent = i;
    btn.className = `px-3 py-2 rounded-md transition-colors ${
      i === currentPage ? "bg-blue-500 text-white" : "bg-zinc-700 text-zinc-300 hover:bg-blue-400"
    }`;
    btn.addEventListener("click", () => {
      currentPage = i;
      renderAnime();
      renderPagination();
      updateResultsInfo();
      scrollToGridTop();
    });
    pagination.appendChild(btn);
  }

  if (currentPage < totalPages) {
    const nextBtn = document.createElement("button");
    nextBtn.textContent = "Next →";
    nextBtn.className =
      "px-4 py-2 bg-zinc-700 text-zinc-300 hover:bg-blue-400 rounded-md transition-colors";
    nextBtn.addEventListener("click", () => {
      currentPage++;
      renderAnime();
      renderPagination();
      updateResultsInfo();
      scrollToGridTop();
    });
    pagination.appendChild(nextBtn);
  }
}

// Clear filters
function clearAllFilters() {
  if (genreSelect) genreSelect.value = "all";
  if (statusSelect) statusSelect.value = "";
  if (seasonSelect) seasonSelect.value = "";
  if (yearSelect) yearSelect.value = "";
  if (sortSelect) sortSelect.value = "default";
  if (searchInput) searchInput.value = "";
  currentPage = 1;
  applyFilters();
}

// Event Listeners
genreSelect?.addEventListener("change", () => { currentPage = 1; applyFilters(); });
statusSelect?.addEventListener("change", () => { currentPage = 1; applyFilters(); });
seasonSelect?.addEventListener("change", () => { currentPage = 1; applyFilters(); });
yearSelect?.addEventListener("change", () => { currentPage = 1; applyFilters(); });
sortSelect?.addEventListener("change", () => { currentPage = 1; applyFilters(); });

searchButton?.addEventListener("click", () => { currentPage = 1; applyFilters(); });
searchInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { currentPage = 1; applyFilters(); }
});
// Debounced live search
const debouncedSearch = debounce(() => { currentPage = 1; applyFilters(); }, 400);
searchInput?.addEventListener("input", debouncedSearch);

clearFiltersBtn?.addEventListener("click", clearAllFilters);
clearSearchBtn?.addEventListener("click", clearAllFilters);
closeModal?.addEventListener("click", closeModalFn);
modal?.addEventListener("click", (e) => { if (e.target === modal) closeModalFn(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.classList.contains("hidden")) closeModalFn();
});

// Initialize
loadFilters();
fetchAnime();
