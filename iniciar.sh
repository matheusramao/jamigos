#!/bin/sh
# Instala as dependências (rápido a partir da segunda vez) e sobe o servidor.
pip install -q -r server/requirements.txt
python server/main.py
