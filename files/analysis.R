# analysis.R: the unemployment note for one region, as a plain script.
# Synthetic data, made for training. Lab 1 turns this into note.qmd.
library(tidyverse)
library(tinytable)

rates <- read_csv("unemployment.csv")
REGION <- "Asir"

area    <- rates |> filter(region == REGION)
kingdom <- rates |> filter(region == "Kingdom")
now  <- last(area$rate)    # 2025 Q4
then <- first(area$rate)   # 2022 Q1
gap  <- now - last(kingdom$rate)

# chart 1: the region over time
ggplot(area, aes(date, rate)) + geom_line()

# chart 2: the region against the Kingdom
both <- rates |> filter(region %in% c(REGION, "Kingdom"))
ggplot(both, aes(date, rate, colour = region)) + geom_line()

# table: the last four quarters
area |> select(quarter, rate) |> slice_tail(n = 4) |> tt()
