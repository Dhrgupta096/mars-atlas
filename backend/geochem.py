"""Mars Odyssey GRS Chemical Data & MGS TES Dust Cover Index (DCI) engine.
Reads/writes data/GRS_DCI_Data.xlsx (sheet: Gamma_Maps_Modified, 1,451 5x5 deg centroids, 29 columns)
using Python stdlib (zipfile + xml.etree.ElementTree) and builds pole-to-pole geochemical grids.
Reference: Karunatillake et al. (2009), JGR Planets 114, E12001, doi:10.1029/2008JE003303;
Ruff & Christensen (2002), MGS TES Dust Cover Index.
"""
from functools import lru_cache
from pathlib import Path
from xml.etree import ElementTree as ET
import zipfile
import numpy as np

XLSX_PATH = Path(__file__).resolve().parent.parent / "data" / "GRS_DCI_Data.xlsx"

HEADERS = [
    "Latitude", "Longitude", "Al", "Ca", "Cl", "Fe", "H2O", "K", "S", "Si", "Th",
    "DCI_recal", "Mask", "Dichotomy", "Volcanic Percent", "Midlat",
    "Northern Lowlands", "Southern Highlands", "Non-Volcanic", "Volcanic",
    "Cl Depleted", "Cl Enriched", "DCI Depleted", "DCI Enriched",
    "H2O Depleted", "H2O Enriched", "S Depleted", "S Enriched", "DCI-Extrema",
