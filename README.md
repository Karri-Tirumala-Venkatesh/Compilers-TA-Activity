# Register Allocation Using Graph Coloring Techniques (CSL 304)

Django web app for comparing **Classical Graph Coloring** and **MOGRA (Multi-Objective Graph Register Allocation)** with an interactive interference-graph visualizer.

## Features

- Interactive graph generation (register count, variable count, density, seed)
- Side-by-side allocation:
  - Classical
  - MOGRA (proposed)
- Visualization:
  - Node coloring by register
  - Spill highlighting
- Comparison metrics:
  - assigned/spilled count
  - spill ratio
  - move penalty
  - bank cost
  - energy cost
  - runtime

## Tech Stack

- Python 3.10+
- Django 5.x
- HTML/CSS/JavaScript (vanilla)

## Setup (Windows / VS Code Terminal)

1. Create and activate venv:

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```

2. Install dependencies:

   ```powershell
   pip install -r requirements.txt
   ```

3. Run migrations:

   ```powershell
   python manage.py migrate
   ```

4. Start server:

   ```powershell
   python manage.py runserver
   ```

5. Open:
   - http://127.0.0.1:8000/

## Project Structure (key files)

- `myapp/templates/myapp/home.html` - main UI
- `myapp/static/myapp/style.css` - styling
- `myapp/static/myapp/visualizer.js` - graph generation + API calls + rendering
- `myapp/views.py` - page + `/api/allocate/` endpoint
- `myapp/allocator.py` - MOGRA + classical allocator logic

## Quick Testing

Use `test_cases.txt` for predefined scenarios.

## Notes

- Same seed => reproducible generated graph.
- MOGRA uses weighted multi-objective scoring for allocation decisions.
