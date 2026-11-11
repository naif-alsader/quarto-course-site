library(tidyverse)

rates <- read_csv("unemployment.csv")

glimpse(rates)

rates |>
  filter(region == "Jazan") |>
  select(quarter, rate) |>
  mutate(change = round(rate - first(rate), 1))

rates |>
  filter(date == max(date)) |>
  arrange(desc(rate))
