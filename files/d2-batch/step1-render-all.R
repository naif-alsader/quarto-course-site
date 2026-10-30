library(tidyverse)

regions <- c("Riyadh", "Jazan", "Asir")

walk(regions, \(r) {
  quarto::quarto_render(
    "report.qmd",
    output_format = "typst",
    execute_params = list(region = r),
    output_file = str_glue("report-{r}.pdf")
  )
})
