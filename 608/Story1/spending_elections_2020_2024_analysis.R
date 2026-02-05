############################################################
# spending_elections_2020_2024_analysis.R
#
# Goal:
#   Build a reproducible pipeline to explore whether federal
#   spending changed across states (FY2020→FY2024), whether
#   those changes correlate with 2020 Biden support and
#   partisan representation, and whether spending deltas
#   correlate with 2024 election outcomes (President/Senate/House).
#
# Inputs:
#   - IIJAFUNDINGASOFMARCH2023.xlsx (optional; snapshot funding)
#     Place it in your working directory, or update the path below.
#
# Data sources (pulled via URL / API):
#   - USAspending.gov API (federal obligations by geography)
#   - unitedstates/congress-legislators (party/chamber by state over time)
#   - 2024 election results (state + district compiled csvs)
#       https://michaelminn.net/tutorials/data/2024-electoral-states.csv
#       https://michaelminn.net/tutorials/data/2024-electoral-districts.csv
#   - 2020 President results: YOU PROVIDE a direct CSV URL
#       (e.g., MIT Election Lab dataset export)
#
# Output:
#   - Tidy analysis tables
#   - Minimal-ink ggplots for your slide deck
#   - Instructions at the end for exporting charts into PPT
#
# Notes:
#   - This is an observational correlation analysis, not causal proof.
#   - For per-capita measures, you must supply population by state and year.
############################################################

########################
# 0) Setup
########################
# Install packages if needed:
# install.packages(c(
#   "tidyverse","janitor","lubridate","httr","jsonlite","readxl",
#   "scales","ggrepel","usmap","officer","rvg"
# ))

library(tidyverse)
library(janitor)
library(lubridate)
library(httr)
library(jsonlite)
library(readxl)
library(scales)
library(ggrepel)
library(usmap)

# Optional (for PPT export)
# library(officer)
# library(rvg)

# Set your working directory in RStudio if needed:
# setwd("path/to/your/project")

########################
# 1) Minimal-ink theme (use everywhere)
########################
theme_min_ink <- function(base_size = 11, grid = TRUE) {
  theme_classic(base_size = base_size) %+replace%
    theme(
      plot.title.position = "plot",
      plot.title = element_text(face = "plain", margin = margin(b = 6)),
      plot.subtitle = element_text(margin = margin(b = 8)),
      axis.title = element_text(face = "plain"),
      axis.line = element_line(linewidth = 0.25),
      axis.ticks = element_line(linewidth = 0.25),
      axis.ticks.length = unit(2, "pt"),
      legend.position = "none",
      panel.grid.major = if (grid) element_line(linewidth = 0.25) else element_blank(),
      panel.grid.minor = element_blank()
    )
}
theme_set(theme_min_ink())

########################
# 2) Optional: Load your IIJA snapshot (as-of March 2023)
########################
# This file is NOT required for the FY2020–FY2024 spending delta analysis,
# but you can include it as a separate “policy/program snapshot” slide.
IIJA_XLSX_PATH <- "IIJAFUNDINGASOFMARCH2023.xlsx"

iija <- NULL
if (file.exists(IIJA_XLSX_PATH)) {
  iija <- read_excel(IIJA_XLSX_PATH) |>
    clean_names() |>
    transmute(
      state_name = str_squish(str_to_upper(state_teritory_or_tribal_nation)),
      iija_total_bil = as.numeric(total_billions)
    )
}

# State/territory name → abbreviation lookup for joins
state_lu <- tibble(state_name = str_to_upper(state.name), state = state.abb) |>
  add_row(state_name = "DISTRICT OF COLUMBIA", state = "DC") |>
  add_row(state_name = "PUERTO RICO", state = "PR") |>
  add_row(state_name = "GUAM", state = "GU") |>
  add_row(state_name = "U.S. VIRGIN ISLANDS", state = "VI") |>
  add_row(state_name = "VIRGIN ISLANDS", state = "VI") |>
  add_row(state_name = "AMERICAN SAMOA", state = "AS") |>
  add_row(state_name = "NORTHERN MARIANA ISLANDS", state = "MP")

if (!is.null(iija)) {
  iija <- iija |>
    left_join(state_lu, by = "state_name")
}

########################
# 3) USAspending: pull obligations by state, FY2020–FY2024
########################
# Wrapper for USAspending API POST requests
usaspending_post <- function(endpoint, body) {
  res <- httr::POST(
    url = paste0("https://api.usaspending.gov", endpoint),
    body = body,
    encode = "json",
    add_headers(`Content-Type` = "application/json")
  )
  httr::stop_for_status(res)
  httr::content(res, as = "parsed", simplifyVector = TRUE)
}

# Pull obligations by state for a given fiscal year
get_state_obligations <- function(fy, scope = "place_of_performance") {
  # FY runs Oct 1 of prior calendar year through Sep 30 of FY year
  body <- list(
    scope = scope,
    geo_layer = "state",
    filters = list(
      time_period = list(list(
        start_date = paste0(fy - 1, "-10-01"),
        end_date   = paste0(fy, "-09-30")
      ))
    )
  )

  out <- usaspending_post("/api/v2/search/spending_by_geography/", body)

  tibble(
    state = toupper(out$results$shape_code),
    fiscal_year = fy,
    obligations = out$results$aggregated_amount
  )
}

# Pull totals for FY2020–FY2024
spending <- purrr::map_dfr(2020:2024, get_state_obligations)

########################
# 4) Population (REQUIRED for per-capita)
########################
# You must provide population by state and fiscal_year.
# Create a CSV called: population_by_state_fy.csv with columns:
#   state,fiscal_year,pop
#
# Example row:
#   CA,2020,39538223
#
# Then load it here.
POP_PATH <- "population_by_state_fy.csv"

pop <- NULL
if (file.exists(POP_PATH)) {
  pop <- read_csv(POP_PATH, show_col_types = FALSE) |>
    clean_names() |>
    transmute(
      state = toupper(state),
      fiscal_year = as.integer(fiscal_year),
      pop = as.numeric(pop)
    )
} else {
  warning("Population file not found: population_by_state_fy.csv. Per-capita metrics will be NA until you add it.")
  pop <- tibble(state = character(), fiscal_year = integer(), pop = numeric())
}

spending_pc <- spending |>
  left_join(pop, by = c("state","fiscal_year")) |>
  mutate(oblig_pc = obligations / pop)

########################
# 5) Spending deltas FY2020→FY2024 (total + per capita)
########################
spending_delta <- spending_pc |>
  filter(fiscal_year %in% c(2020, 2024)) |>
  select(state, fiscal_year, obligations, oblig_pc) |>
  pivot_wider(
    names_from = fiscal_year,
    values_from = c(obligations, oblig_pc),
    names_sep = "_"
  ) |>
  mutate(
    delta_total = obligations_2024 - obligations_2020,
    delta_pc = oblig_pc_2024 - oblig_pc_2020,
    pct_change = delta_total / obligations_2020
  )

########################
# 6) Party composition in House/Senate by state (2020–2024)
########################
leg_current <- fromJSON("https://theunitedstates.io/congress-legislators/legislators-current.json")
leg_hist    <- fromJSON("https://theunitedstates.io/congress-legislators/legislators-historical.json")

terms <- bind_rows(leg_current, leg_hist) |>
  select(id, terms) |>
  unnest(terms) |>
  transmute(
    bioguide_id = id$bioguide,
    state = toupper(state),
    chamber = if_else(type == "rep", "House", "Senate"),
    party = party,
    start = as.Date(start),
    end = as.Date(end)
  )

asof <- tibble(
  year = 2020:2024,
  as_of = as.Date(paste0(year, "-01-03"))
)

deleg <- terms |>
  inner_join(asof, join_by(start <= as_of, end >= as_of)) |>
  mutate(
    party_simple = case_when(
      str_detect(party, regex("^dem", ignore_case = TRUE)) ~ "D",
      str_detect(party, regex("^rep", ignore_case = TRUE)) ~ "R",
      TRUE ~ "O"
    )
  ) |>
  group_by(year, state, chamber) |>
  summarize(
    n = n(),
    n_d = sum(party_simple == "D"),
    n_r = sum(party_simple == "R"),
    dem_share = n_d / n,
    .groups = "drop"
  ) |>
  pivot_wider(names_from = chamber, values_from = c(n, n_d, n_r, dem_share))

deleg_ref <- deleg |> filter(year == 2023)

########################
# 7) Elections: 2024 (President state; House district→state; Senate winner info)
########################
URL_STATES_2024    <- "https://michaelminn.net/tutorials/data/2024-electoral-states.csv"
URL_DISTRICTS_2024 <- "https://michaelminn.net/tutorials/data/2024-electoral-districts.csv"

states_2024 <- read_csv(URL_STATES_2024, show_col_types = FALSE) |> clean_names()
districts_2024 <- read_csv(URL_DISTRICTS_2024, show_col_types = FALSE) |> clean_names()

pres_2024_state <- states_2024 |>
  transmute(
    state = st,
    pres_dem_votes   = votes_dem_2024,
    pres_gop_votes   = votes_gop_2024,
    pres_other_votes = votes_other_2024,
    pres_total_votes = pres_dem_votes + pres_gop_votes + pres_other_votes,
    pres_dem_share_2p = pres_dem_votes / (pres_dem_votes + pres_gop_votes),
    pres_margin_dem   = (pres_dem_votes - pres_gop_votes) / (pres_dem_votes + pres_gop_votes),
    pres_dem_won = pres_dem_votes > pres_gop_votes
  )

sen_2024_state <- states_2024 |>
  transmute(
    state = st,
    sen_year = senate1_year,
    sen_party = senate1_party,
    sen_percent = senate1_percent
  ) |>
  filter(!is.na(sen_year), sen_year == 2024) |>
  mutate(
    sen_winner_party = case_when(
      str_detect(tolower(sen_party), "^dem") ~ "D",
      str_detect(tolower(sen_party), "^rep") ~ "R",
      TRUE ~ "O"
    ),
    sen_dem_won = sen_winner_party == "D",
    sen_winner_share = sen_percent / 100
  ) |>
  select(state, sen_dem_won, sen_winner_party, sen_winner_share)

house_2024_state <- districts_2024 |>
  transmute(
    state = st,
    district = name,
    dem_votes   = votes_dem_2024,
    gop_votes   = votes_gop_2024,
    other_votes = votes_other_2024,
    total_votes = dem_votes + gop_votes + other_votes,
    dem_won = dem_votes > gop_votes
  ) |>
  group_by(state) |>
  summarize(
    house_dem_votes = sum(dem_votes, na.rm = TRUE),
    house_gop_votes = sum(gop_votes, na.rm = TRUE),
    house_other_votes = sum(other_votes, na.rm = TRUE),
    house_total_votes = sum(total_votes, na.rm = TRUE),
    house_dem_share_2p = house_dem_votes / (house_dem_votes + house_gop_votes),
    house_margin_dem   = (house_dem_votes - house_gop_votes) / (house_dem_votes + house_gop_votes),
    seats_dem = sum(dem_won, na.rm = TRUE),
    seats_gop = sum(!dem_won, na.rm = TRUE),
    seats_total = n(),
    seat_share_dem = seats_dem / seats_total,
    .groups = "drop"
  )

elections_2024 <- pres_2024_state |>
  left_join(sen_2024_state, by = "state") |>
  left_join(house_2024_state, by = "state")

########################
# 8) Elections: 2020 President (YOU PROVIDE URL)
########################
PRES2020_URL <- ""  # <- PUT YOUR CSV URL HERE

pres2020 <- NULL
if (nzchar(PRES2020_URL)) {
  pres_long <- read_csv(PRES2020_URL, show_col_types = FALSE) |>
    clean_names() |>
    filter(year == 2020) |>
    mutate(state = toupper(state_po))

  pres2020 <- pres_long |>
    group_by(state) |>
    summarize(
      votes_total = sum(candidatevotes, na.rm = TRUE),
      votes_biden = sum(candidatevotes[str_detect(toupper(candidate), "BIDEN")], na.rm = TRUE),
      votes_trump = sum(candidatevotes[str_detect(toupper(candidate), "TRUMP")], na.rm = TRUE),
      biden_share_2p = votes_biden / (votes_biden + votes_trump),
      biden_won = votes_biden > votes_trump,
      .groups = "drop"
    )
} else {
  warning("PRES2020_URL is empty. 2020 Biden vote share measures will be NA until you provide a URL.")
  pres2020 <- tibble(state = character(), biden_share_2p = numeric(), biden_won = logical())
}

########################
# 9) Assemble analysis frames
########################
analysis_reward <- spending_delta |>
  left_join(pres2020, by = "state") |>
  left_join(deleg_ref, by = "state") |>
  { if (!is.null(iija)) left_join(., iija |> select(state, iija_total_bil), by = "state") else . }

analysis_outcomes_2024 <- analysis_reward |>
  left_join(elections_2024, by = "state")

########################
# 10) Charts for slide deck (minimal ink)
########################

# Dumbbell: FY2020 vs FY2024 obligations per capita
dumbbell_df <- spending_pc |>
  filter(fiscal_year %in% c(2020, 2024), !is.na(oblig_pc)) |>
  select(state, fiscal_year, oblig_pc) |>
  pivot_wider(names_from = fiscal_year, values_from = oblig_pc, names_prefix = "fy") |>
  mutate(delta = fy2024 - fy2020) |>
  arrange(delta) |>
  mutate(state = factor(state, levels = state))

p_dumbbell_pc <- ggplot(dumbbell_df, aes(y = state)) +
  geom_segment(aes(x = fy2020, xend = fy2024, yend = state), linewidth = 0.35) +
  geom_point(aes(x = fy2020), size = 1.6, alpha = 0.9) +
  geom_point(aes(x = fy2024), size = 1.6, alpha = 0.9) +
  scale_x_continuous(labels = label_dollar(accuracy = 1)) +
  labs(
    title = "Federal obligations per capita: FY2020 vs FY2024",
    x = "Obligations per capita",
    y = NULL
  ) +
  theme_min_ink(grid = FALSE)

# Ranked dot: delta per capita by state
rank_df <- analysis_reward |>
  filter(!is.na(delta_pc)) |>
  arrange(delta_pc) |>
  mutate(state = factor(state, levels = state))

p_rank_delta_pc <- ggplot(rank_df, aes(x = delta_pc, y = state)) +
  geom_vline(xintercept = 0, linewidth = 0.25) +
  geom_point(size = 1.8, alpha = 0.9) +
  scale_x_continuous(labels = label_dollar(accuracy = 1)) +
  labs(
    title = "Change in federal obligations per capita (FY2024 − FY2020)",
    x = "Δ obligations per capita",
    y = NULL
  ) +
  theme_min_ink(grid = TRUE)

# Reward test: delta per-capita vs Biden 2020 share
p_reward_scatter <- ggplot(analysis_reward, aes(x = biden_share_2p, y = delta_pc)) +
  geom_hline(yintercept = 0, linewidth = 0.25) +
  geom_point(size = 1.8, alpha = 0.85) +
  geom_smooth(method = "lm", se = FALSE, linewidth = 0.6) +
  scale_x_continuous(labels = label_percent(accuracy = 1)) +
  scale_y_continuous(labels = label_dollar(accuracy = 1)) +
  labs(
    title = "Spending change vs Biden 2020 support",
    x = "Biden 2020 two-party vote share",
    y = "Δ obligations per capita"
  )

# Biden-won vs not: delta per-capita boxplot
p_reward_box <- ggplot(analysis_reward, aes(x = factor(biden_won), y = delta_pc)) +
  geom_hline(yintercept = 0, linewidth = 0.25) +
  geom_boxplot(outlier.size = 1.2, linewidth = 0.35) +
  scale_y_continuous(labels = label_dollar(accuracy = 1)) +
  labs(
    title = "Spending change by 2020 presidential outcome",
    x = "Biden won state (FALSE/TRUE)",
    y = "Δ obligations per capita"
  ) +
  theme_min_ink(grid = TRUE)

# Corollary: delta per-capita vs 2024 Presidential margin
p_outcome_pres <- ggplot(analysis_outcomes_2024, aes(x = delta_pc, y = pres_margin_dem)) +
  geom_hline(yintercept = 0, linewidth = 0.25) +
  geom_vline(xintercept = 0, linewidth = 0.25) +
  geom_point(size = 1.8, alpha = 0.85) +
  geom_smooth(method = "lm", se = FALSE, linewidth = 0.6) +
  scale_x_continuous(labels = label_dollar(accuracy = 1)) +
  scale_y_continuous(labels = label_percent(accuracy = 1)) +
  labs(
    title = "Spending change vs 2024 presidential margin",
    x = "Δ obligations per capita (FY2024 − FY2020)",
    y = "2024 presidential margin (Dem − GOP, two-party)"
  )

# Corollary: delta per-capita vs 2024 House margin
p_outcome_house <- ggplot(analysis_outcomes_2024, aes(x = delta_pc, y = house_margin_dem)) +
  geom_hline(yintercept = 0, linewidth = 0.25) +
  geom_vline(xintercept = 0, linewidth = 0.25) +
  geom_point(size = 1.8, alpha = 0.85) +
  geom_smooth(method = "lm", se = FALSE, linewidth = 0.6) +
  scale_x_continuous(labels = label_dollar(accuracy = 1)) +
  scale_y_continuous(labels = label_percent(accuracy = 1)) +
  labs(
    title = "Spending change vs 2024 House margin",
    x = "Δ obligations per capita (FY2024 − FY2020)",
    y = "2024 House margin (Dem − GOP, two-party)"
  )

# Optional map: FY2024 obligations per capita (states + DC only)
map_df <- spending_pc |>
  filter(fiscal_year == 2024, state %in% c(state.abb, "DC"), !is.na(oblig_pc)) |>
  select(state, oblig_pc)

p_map_2024_pc <- plot_usmap(data = map_df, values = "oblig_pc") +
  scale_fill_continuous(labels = label_dollar(accuracy = 1)) +
  labs(
    title = "FY2024 federal obligations per capita (states + DC)",
    fill = "Obligations per capita"
  ) +
  theme_min_ink(grid = FALSE) +
  theme(legend.position = "right")

########################
# 11) Export charts to PNG (easy PPT insertion)
########################
dir.create("charts", showWarnings = FALSE)

ggsave("charts/01_dumbbell_pc.png", p_dumbbell_pc, width = 10, height = 6, dpi = 300)
ggsave("charts/02_rank_delta_pc.png", p_rank_delta_pc, width = 10, height = 6, dpi = 300)
ggsave("charts/03_reward_scatter.png", p_reward_scatter, width = 10, height = 6, dpi = 300)
ggsave("charts/04_reward_box.png", p_reward_box, width = 8, height = 5, dpi = 300)
ggsave("charts/05_outcome_pres.png", p_outcome_pres, width = 10, height = 6, dpi = 300)
ggsave("charts/06_outcome_house.png", p_outcome_house, width = 10, height = 6, dpi = 300)
ggsave("charts/07_map_2024_pc.png", p_map_2024_pc, width = 10, height = 6, dpi = 300)

########################
# 12) Optional quick models (interpretation: direct/inverse/indeterminate)
########################
# Use these as supporting analysis; avoid causal language.
if (nrow(analysis_outcomes_2024) > 0) {
  m_pres <- lm(pres_margin_dem ~ delta_pc + biden_share_2p + dem_share_Senate + dem_share_House,
              data = analysis_outcomes_2024)
  m_house <- lm(house_margin_dem ~ delta_pc + biden_share_2p + dem_share_Senate + dem_share_House,
               data = analysis_outcomes_2024)

  cat("
--- Model: 2024 Presidential margin ---
")
  print(summary(m_pres))

  cat("
--- Model: 2024 House margin ---
")
  print(summary(m_house))
}

############################################################
# INSTRUCTIONS: Add charts to a PPT presentation
############################################################

# Option A (fast): insert PNGs into PowerPoint manually
#
# 1) Run this script. It will save PNGs into the ./charts/ folder:
#      charts/01_dumbbell_pc.png
#      charts/02_rank_delta_pc.png
#      ...
# 2) In PowerPoint:
#    - Choose a blank slide layout
#    - Insert → Pictures → This Device…
#    - Select the PNG and place it
# 3) Add a slide title and 1–2 lines of supporting text (minimal ink).

# Option B (recommended): programmatically build a PPT in R using officer + rvg
#
# 1) Uncomment these library calls near the top:
#      library(officer)
#      library(rvg)
#
# 2) Use PNG insertion (simple) OR editable vector charts (best):
#
# ---- B1) PNG insertion (simple, reliable) ----
# ppt <- read_pptx()
# ppt <- add_slide(ppt, layout = "Title and Content", master = "Office Theme")
# ppt <- ph_with(ppt, value = "Federal obligations per capita: FY2020 vs FY2024",
#                location = ph_location_type(type = "title"))
# ppt <- ph_with(ppt, external_img("charts/01_dumbbell_pc.png", width = 10, height = 6),
#                location = ph_location_type(type = "body"))
# print(ppt, target = "spending_elections_deck.pptx")
#
# ---- B2) Vector insertion (editable in PPT; preferred) ----
# ppt <- read_pptx()
# ppt <- add_slide(ppt, layout = "Title and Content", master = "Office Theme")
# ppt <- ph_with(ppt, value = "Spending change vs Biden 2020 support",
#                location = ph_location_type(type = "title"))
# ppt <- ph_with(ppt, dml(ggobj = p_reward_scatter),
#                location = ph_location(left = 0.5, top = 1.4, width = 12.5, height = 5.5))
# print(ppt, target = "spending_elections_deck.pptx")
#
# 3) Repeat add_slide() + ph_with() for each chart in story order:
#    - Setup (questions + methods) as text slides
#    - Spending change visuals (dumbbell, rank, map)
#    - Reward test visuals (scatter, boxplot)
#    - 2024 outcomes visuals (pres, house; senate optional)
#    - Conclusions/limitations
#
# Tip (minimal-ink slides):
# - Keep titles short and declarative
# - Add only 1–2 bullets of supporting text per slide
# - Avoid legends; label axes clearly and use consistent units
############################################################
