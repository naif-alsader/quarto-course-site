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

rates |>
  group_by(region) |>
  summarise(start = first(rate), end = last(rate))

latest <- rates |>
  filter(region == "Jazan") |>
  pull(rate) |>
  last()
latest

str_glue("Jazan, latest quarter: {latest}%")

jazan <- rates |> filter(region == "Jazan")

ggplot(jazan, aes(date, rate)) +
  geom_line() +
  geom_point()

both <- rates |>
  filter(region %in% c("Jazan", "Kingdom"))

ggplot(both, aes(date, rate, colour = region)) +
  geom_line() +
  labs(title = "Jazan and the Kingdom",
       y = "Unemployment rate (%)",
       x = NULL, colour = NULL)
