# NZ-MoH-Datascrape
Data Scrape of the New Zealand Ministry of Health website for Covid-19 with wget tools. This is a limited data set, not the whole site for both space and resorce reasons.

This is purely an as is where is information dump for reference purposes, no warranty, accuracy, or any other implicaiton is offered or provided.

The 1 pm data release will be scraped at 1:45pm each day
* Current cases https://www.health.govt.nz/our-work/diseases-and-conditions/covid-19-novel-coronavirus/covid-19-data-and-statistics/covid-19-current-cases
* Testing for Covid-19 https://www.health.govt.nz/our-work/diseases-and-conditions/covid-19-novel-coronavirus/covid-19-data-and-statistics/testing-covid-19
* Covid tracer app https://www.health.govt.nz/our-work/diseases-and-conditions/covid-19-novel-coronavirus/covid-19-data-and-statistics/covid-19-nz-covid-tracer-app-data
* Vaccination data https://www.health.govt.nz/our-work/diseases-and-conditions/covid-19-novel-coronavirus/covid-19-data-and-statistics/covid-19-vaccine-data

The locations of interest data will be scraped at 20 past the hour every 2 hours between 6am and 8pm from this source https://www.health.govt.nz/our-work/diseases-and-conditions/covid-19-novel-coronavirus/covid-19-health-advice-public/contact-tracing-covid-19/covid-19-contact-tracing-locations-interest

The web page data is being localised so it should be viewable if accessed locally
* The daily data release with csv or xls files for vaccines, cases, and tracer app will be included.

The data does not included consolidated testing data, that is available from the NZ Statistics website https://www.stats.govt.nz/experimental/covid-19-data-portal

I have found substantial inaccuracy between media and press conference reported data and the data from the MoH website. Event he data feed data differs from the scraped web pages. I suspect this is a function of timing of the data extractions and isn't necessarily faulty data.

Establising community cases from international travel cases is not the easiest with the website data. The downloaded xls/csv data has international travel tags which can assist with this aspect.
