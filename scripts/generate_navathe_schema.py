"""
Generates the tightly cropped Elmasri & Navathe DBMS textbook-style Relational Schema Diagram
without the top banner and footer notes, matching the user's cropped layout.
"""

import os
import subprocess

tables = [
    {
        "name": "USERS",
        "cols": ["user_id", "email", "password_hash", "full_name", "role", "semester", "reputation", "created_at"],
        "pks": ["user_id"]
    },
    {
        "name": "COURSES",
        "cols": ["course_id", "code", "title"],
        "pks": ["course_id"]
    },
    {
        "name": "CONCEPTS",
        "cols": ["concept_id", "course_id", "name", "description", "embedding"],
        "pks": ["concept_id"]
    },
    {
        "name": "CONCEPT_PREREQUISITES",
        "cols": ["concept_id", "prerequisite_id"],
        "pks": ["concept_id", "prerequisite_id"]
    },
    {
        "name": "ENROLMENTS",
        "cols": ["user_id", "course_id", "academic_term", "enrolled_on"],
        "pks": ["user_id", "course_id"]
    },
    {
        "name": "MASTERY",
        "cols": ["user_id", "concept_id", "score", "note", "mastered_at", "embedding"],
        "pks": ["user_id", "concept_id"]
    },
    {
        "name": "AVAILABILITY_SLOTS",
        "cols": ["slot_id", "helper_id", "start_time", "end_time", "is_booked"],
        "pks": ["slot_id"]
    },
    {
        "name": "DOUBTS",
        "cols": ["doubt_id", "asker_id", "course_id", "concept_id", "title", "body", "status", "embedding", "search_tsv", "created_at"],
        "pks": ["doubt_id"]
    },
    {
        "name": "SESSIONS",
        "cols": ["session_id", "doubt_id", "helper_id", "asker_id", "slot_id", "status", "rating", "feedback", "created_at", "completed_at"],
        "pks": ["session_id"]
    },
    {
        "name": "AUDIT_LOG",
        "cols": ["log_id", "table_name", "action", "row_id", "details", "changed_at"],
        "pks": ["log_id"]
    }
]

fks = [
    ("CONCEPTS", "course_id", "COURSES", "course_id"),
    ("CONCEPT_PREREQUISITES", "concept_id", "CONCEPTS", "concept_id"),
    ("CONCEPT_PREREQUISITES", "prerequisite_id", "CONCEPTS", "concept_id"),
    ("ENROLMENTS", "user_id", "USERS", "user_id"),
    ("ENROLMENTS", "course_id", "COURSES", "course_id"),
    ("MASTERY", "user_id", "USERS", "user_id"),
    ("MASTERY", "concept_id", "CONCEPTS", "concept_id"),
    ("AVAILABILITY_SLOTS", "helper_id", "USERS", "user_id"),
    ("DOUBTS", "asker_id", "USERS", "user_id"),
    ("DOUBTS", "course_id", "COURSES", "course_id"),
    ("DOUBTS", "concept_id", "CONCEPTS", "concept_id"),
    ("SESSIONS", "doubt_id", "DOUBTS", "doubt_id"),
    ("SESSIONS", "helper_id", "USERS", "user_id"),
    ("SESSIONS", "asker_id", "USERS", "user_id"),
    ("SESSIONS", "slot_id", "AVAILABILITY_SLOTS", "slot_id")
]

START_X = 50
START_Y = 40
TABLE_GAP_Y = 135
ROW_HEIGHT = 34
CHAR_WIDTH = 9.2
PADDING_X = 24

svg_elements = []

table_meta = {}
current_y = START_Y

for t in tables:
    name = t["name"]
    cols = t["cols"]
    pks = set(t["pks"])
    
    col_widths = []
    for c in cols:
        w = max(78, int(len(c) * CHAR_WIDTH + PADDING_X))
        col_widths.append(w)
        
    table_meta[name] = {
        "x": START_X,
        "y": current_y,
        "cols": {},
        "pks": pks,
        "total_width": sum(col_widths)
    }
    
    # Table name
    svg_elements.append(f"""
      <text x="{START_X}" y="{current_y - 10}" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="14" font-weight="bold" fill="#111827">
        {name}
      </text>
    """)
    
    cur_x = START_X
    for col_name, w in zip(cols, col_widths):
        table_meta[name]["cols"][col_name] = {
            "x": cur_x,
            "y": current_y,
            "w": w,
            "h": ROW_HEIGHT,
            "center_x": cur_x + w / 2,
            "bottom_y": current_y + ROW_HEIGHT
        }
        
        # Cell box
        svg_elements.append(f"""
          <rect x="{cur_x}" y="{current_y}" width="{w}" height="{ROW_HEIGHT}" fill="#ededed" stroke="#374151" stroke-width="1.2" />
        """)
        
        # Text
        is_pk = col_name in pks
        text_decor = 'text-decoration="underline"' if is_pk else ''
        font_weight = "bold" if is_pk else "normal"
        svg_elements.append(f"""
          <text x="{cur_x + w/2}" y="{current_y + 22}" text-anchor="middle" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="13" font-weight="{font_weight}" fill="#111827" {text_decor}>
            {col_name}
          </text>
        """)
        
        cur_x += w
        
    current_y += TABLE_GAP_Y

pk_target_counts = {}
for (_, _, to_t, to_c) in fks:
    key = (to_t, to_c)
    pk_target_counts[key] = pk_target_counts.get(key, 0) + 1

pk_current_index = {k: 0 for k in pk_target_counts}

RIGHT_BASE_X = 1120
right_channel_index = 0

for idx, (from_t, from_c, to_t, to_c) in enumerate(fks):
    from_info = table_meta[from_t]["cols"][from_c]
    to_info = table_meta[to_t]["cols"][to_c]
    
    x_from = from_info["center_x"]
    y_from = from_info["bottom_y"]
    
    k = (to_t, to_c)
    total_targets = pk_target_counts[k]
    cur_target_idx = pk_current_index[k]
    pk_current_index[k] += 1
    
    if total_targets > 1:
        spread = min(14, (to_info["w"] - 20) / (total_targets))
        offset = (cur_target_idx - (total_targets - 1) / 2) * spread
    else:
        offset = 0
        
    x_to = to_info["center_x"] + offset
    y_to = to_info["bottom_y"]
    
    drop_y = y_from + 15 + (idx % 4) * 6
    channel_x = max(table_meta[from_t]["total_width"] + START_X + 25, RIGHT_BASE_X) + right_channel_index * 16
    right_channel_index += 1
    
    approach_y = y_to + 18 + (cur_target_idx % 3) * 6
    
    path_d = f"M {x_from} {y_from} L {x_from} {drop_y} L {channel_x} {drop_y} L {channel_x} {approach_y} L {x_to} {approach_y} L {x_to} {y_to + 7}"
        
    svg_elements.append(f"""
      <path d="{path_d}" fill="none" stroke="#1f2937" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
    """)
    
    arrowhead_points = f"{x_to},{y_to} {x_to - 4.5},{y_to + 7} {x_to + 4.5},{y_to + 7}"
    svg_elements.append(f"""
      <polygon points="{arrowhead_points}" fill="#111827" />
    """)

canvas_width = 1420
canvas_height = current_y - 40

svg_full = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {canvas_width} {canvas_height}" width="{canvas_width}" height="{canvas_height}">
  <rect width="100%" height="100%" fill="#ffffff" />
  {''.join(svg_elements)}
</svg>"""

out_dir = os.path.join(os.path.dirname(__file__), "..", "docs")
os.makedirs(out_dir, exist_ok=True)
svg_path = os.path.join(out_dir, "relational_schema.svg")
html_path = os.path.join(out_dir, "relational_schema.html")
png_path = os.path.join(out_dir, "relational_schema.png")

with open(svg_path, "w", encoding="utf-8") as f:
    f.write(svg_full)

html_content = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {{
      margin: 0;
      padding: 20px;
      background: white;
      display: flex;
      justify-content: center;
    }}
  </style>
</head>
<body>
  {svg_full}
</body>
</html>
"""

with open(html_path, "w", encoding="utf-8") as f:
    f.write(html_content)

edge_exe = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if os.path.exists(edge_exe):
    cmd = [
        edge_exe,
        "--headless",
        "--no-sandbox",
        "--disable-gpu",
        f"--window-size={canvas_width + 40},{canvas_height + 40}",
        "--device-scale-factor=2",
        f"--screenshot={png_path}",
        html_path
    ]
    subprocess.run(cmd, check=True)
    print(f"Generated clean cropped diagram:\n  PNG: {png_path}\n  SVG: {svg_path}")
