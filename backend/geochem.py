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
]

ELEMENTS = {
    "Fe":  {"symbol": "Fe",  "name": "Iron (Fe)",              "unit": "z-score (σ)", "role": "Basaltic crust, hematite & ferric oxides (high in Northern Lowlands / Acidalia)"},
    "H2O": {"symbol": "H2O", "name": "Water / Hydrogen (H₂O)", "unit": "z-score (σ)", "role": "Hydrated sulfates, phyllosilicates & subsurface ground ice (Arabia, Utopia, Poles)"},
    "Si":  {"symbol": "Si",  "name": "Silicon (Si)",           "unit": "z-score (σ)", "role": "Silicate crust, silica sinter & andesitic volcanics"},
    "S":   {"symbol": "S",   "name": "Sulfur (S)",             "unit": "z-score (σ)", "role": "Evaporite sulfate beds & volcanic outgassing (Meridiani, Valles Marineris, Tharsis)"},
    "Cl":  {"symbol": "Cl",  "name": "Chlorine (Cl)",          "unit": "z-score (σ)", "role": "Perchlorates, halite evaporites & aqueous brine deposits (Medusae Fossae, Tharsis)"},
    "K":   {"symbol": "K",   "name": "Potassium (K)",          "unit": "z-score (σ)", "role": "Incompatible crustal element & K-feldspar / illite clays"},
    "Th":  {"symbol": "Th",  "name": "Thorium (Th)",           "unit": "z-score (σ)", "role": "Natural radiogenic heat tracer & evolved crustal igneous provinces"},
