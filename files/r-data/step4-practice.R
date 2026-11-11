library(tidyverse)

rates <- read_csv("unemployment.csv")

glimpse(rates)

rates |>
  filter(region == "Jazan") |>
  select(quarter, rate)
