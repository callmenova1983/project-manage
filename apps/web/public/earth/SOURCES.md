# Project map Earth imagery

`black-marble-2016.jpg` is an equirectangular satellite composite from NASA Earth Observatory, **Black Marble 2016**. It represents observed night lights in 2016, not current project activity. The asset is served locally; the map does not contact a tile provider at runtime.

The local texture is **8,192 × 4,096 pixels**, resized with macOS `sips` from the original 13,500 × 6,750 JPEG. Resizing preserves the full 2:1 equirectangular extent and geographic alignment; no cropping, generated geography, or added lights are used.

- Dataset and original resolution: https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/
- Original 13,500 × 6,750 JPEG: https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg
- NASA image usage guidance: https://www.nasa.gov/nasa-brand-center/images-and-media/

Credit: NASA Earth Observatory. NASA/NOAA Suomi NPP satellite, VIIRS instrument.

Rendering places this real-world image on a three-dimensional sphere using an equirectangular UV mapping. Project markers use latitude/longitude separately; shader colors and atmospheric glow are presentational. City positions indicate city centers, not exact project addresses. No synthetic geography or generated map image is used.
