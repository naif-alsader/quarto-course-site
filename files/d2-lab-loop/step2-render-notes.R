library(tidyverse)

regions <- c("Riyadh", "Makkah", "Eastern Province",
             "Asir", "Tabuk", "Jazan")

walk(regions, \(r) {
  slug <- r |> str_to_lower() |> str_replace_all(" ", "-")
  quarto::quarto_render(
    "note.qmd",
    output_format = "typst",
    execute_params = list(region = r),
    output_file = str_glue("note-{slug}.pdf")
  )
})
