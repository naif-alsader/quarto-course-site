library(tidyverse)

regions <- read_csv("regions.csv") |> pull(region_en)

walk(regions, \(r) {
  slug <- r |> str_to_lower() |> str_replace_all(" ", "-")
  quarto::quarto_render(
    "report.qmd",
    output_format = "typst",
    execute_params = list(region = r),
    output_file = str_glue("report-{slug}.pdf")
  )
})
