#!/usr/bin/env python3
"""
Builds the PeerBridge ER diagram in Chen notation (Elmasri & Navathe style, as in the
DBMS course slides: Unit 1 "ER Notations" and "Example of Chen Notation").

  grey rectangle = entity            diamond          = relationship
  ellipse        = attribute         underlined       = key attribute
  dashed ellipse = derived attribute double line      = total participation
  single line    = partial participation              1 / N / M = cardinality ratio

Usage : python3 scripts/make_er_diagram.py
Needs : Graphviz ("neato" on PATH).  Writes docs/er_diagram.dot, .svg and .png
"""
import os
import subprocess
import sys

SEED = int(sys.argv[1]) if len(sys.argv) > 1 else 7   # layout seed (changes the arrangement)

# ---------------------------------------------------------------- model ----
# entity -> attributes ; kind: key | plain | derived     (derived: reputation is kept by
# a trigger, search_tsv is a GENERATED column)
ENTITIES = {
    "USER": [("user_id", "key"), ("email", "plain"), ("password_hash", "plain"),
             ("full_name", "plain"), ("role", "plain"), ("semester", "plain"),
             ("reputation", "derived"), ("created_at", "plain")],
    "COURSE": [("course_id", "key"), ("code", "plain"), ("title", "plain")],
    "CONCEPT": [("concept_id", "key"), ("name", "plain"), ("description", "plain"),
                ("embedding", "plain")],
    "DOUBT": [("doubt_id", "key"), ("title", "plain"), ("body", "plain"),
              ("status", "plain"), ("embedding", "plain"), ("search_tsv", "derived"),
              ("created_at", "plain")],
    "AVAILABILITY_SLOT": [("slot_id", "key"), ("start_time", "plain"),
                          ("end_time", "plain"), ("is_booked", "plain")],
    "SESSION": [("session_id", "key"), ("status", "plain"), ("rating", "plain"),
                ("feedback", "plain"), ("created_at", "plain"), ("completed_at", "plain")],
    "AUDIT_LOG": [("log_id", "key"), ("table_name", "plain"), ("action", "plain"),
                  ("row_id", "plain"), ("details", "plain"), ("changed_at", "plain")],
}

# relationship -> (own attributes, [(entity, cardinality, participation, role)])
# participation: total (NOT NULL foreign key / primary-key part) | partial
RELATIONSHIPS = {
    "ENROLS": ([("academic_term", "plain"), ("enrolled_on", "plain")],
               [("USER", "M", "partial", None), ("COURSE", "N", "partial", None)]),
    "CONTAINS": ([], [("COURSE", "1", "partial", None), ("CONCEPT", "N", "total", None)]),
    "MASTERS": ([("score", "plain"), ("note", "plain"), ("mastered_at", "plain"),
                 ("embedding", "plain")],
                [("USER", "M", "partial", None), ("CONCEPT", "N", "partial", None)]),
    "PREREQUISITE_OF": ([], [("CONCEPT", "M", "partial", "dependent"),
                             ("CONCEPT", "N", "partial", "prerequisite")]),
    "ASKS": ([], [("USER", "1", "partial", None), ("DOUBT", "N", "total", None)]),
    "ABOUT": ([], [("COURSE", "1", "partial", None), ("DOUBT", "N", "total", None)]),
    "TAGGED_WITH": ([], [("CONCEPT", "1", "partial", None), ("DOUBT", "N", "partial", None)]),
    "OFFERS": ([], [("USER", "1", "partial", None), ("AVAILABILITY_SLOT", "N", "total", None)]),
    "RESOLVED_BY": ([], [("DOUBT", "1", "partial", None), ("SESSION", "N", "total", None)]),
    "BOOKED_IN": ([], [("AVAILABILITY_SLOT", "1", "partial", None),
                       ("SESSION", "N", "total", None)]),
    "HELPS": ([], [("USER", "1", "partial", "helper"), ("SESSION", "N", "total", None)]),
    "RECEIVES_HELP": ([], [("USER", "1", "partial", "asker"), ("SESSION", "N", "total", None)]),
}

# label tweaks where two cardinality labels would collide
LABEL_ANGLE = {("ABOUT", "DOUBT", 1): 70, ("TAGGED_WITH", "DOUBT", 1): -70,
               ("CONTAINS", "CONCEPT", 1): -70, ("PREREQUISITE_OF", "CONCEPT", 0): 55,
               ("PREREQUISITE_OF", "CONCEPT", 1): -55}

# ---------------------------------------------------------------- build ----
L = ['graph ER {',
     f'  layout=neato; overlap=prism; overlap_scaling=4; sep="+16"; splines=true; start={SEED};',
     '  graph [bgcolor=white, pad=0.4, fontname="DejaVu Sans", labelloc=t, fontsize=26, '
     'label="PeerBridge - ER diagram (Chen notation)\\n"];',
     '  node  [fontname="DejaVu Sans", fontsize=12];',
     '  edge  [fontname="DejaVu Sans", fontsize=13, color="#000000", penwidth=1.2];']


def attr_node(nid, label, kind):
    lab = f"<<u>{label}</u>>" if kind == "key" else f'"{label}"'
    style = "dashed" if kind == "derived" else "solid"
    L.append(f'  {nid} [shape=ellipse, style={style}, label={lab}, width=0.5, height=0.35];')


for ent, attrs in ENTITIES.items():
    L.append(f'  {ent} [shape=box, style=filled, fillcolor="#d9d9d9", fontsize=15, '
             f'fontname="DejaVu Sans Bold", penwidth=1.8, margin="0.25,0.14"];')
    for lab, kind in attrs:
        nid = f"{ent}__{lab}"
        attr_node(nid, lab, kind)
        L.append(f'  {ent} -- {nid} [len=1.15];')

for rel, (rattrs, ends) in RELATIONSHIPS.items():
    L.append(f'  {rel} [shape=diamond, style=filled, fillcolor="#d9eef0", fontsize=11, '
             f'fontname="DejaVu Sans Bold", penwidth=1.6];')
    for lab, kind in rattrs:
        nid = f"{rel}__{lab}"
        attr_node(nid, lab, kind)
        L.append(f'  {rel} -- {nid} [len=1.1];')
    for i, (ent, card, part, role) in enumerate(ends):
        color = '"#000000:#ffffff:#000000"' if part == "total" else '"#000000"'
        rec = (rel == "PREREQUISITE_OF")      # recursive: two separate lines to CONCEPT
        ang = LABEL_ANGLE.get((rel, ent, i), -25 if i == 0 else 25)
        ports = ""
        if rec:
            ports = ', tailport=w, headport=sw' if i == 0 else ', tailport=e, headport=se'
        xl = f', xlabel=<<i>{role}</i>>' if role else ''
        L.append(f'  {rel} -- {ent} [len={3.0 if rec else 2.0}, color={color}, '
                 f'headlabel="{card}", labeldistance=2.2, labelangle={ang}, labelfontsize=15, '
                 f'labelfontname="DejaVu Sans Bold"{ports}{xl}];')
L.append('}')

dot = "\n".join(L)
here = os.path.dirname(os.path.abspath(__file__))
docs = os.path.normpath(os.path.join(here, "..", "docs"))
os.makedirs(docs, exist_ok=True)
with open(os.path.join(docs, "er_diagram.dot"), "w", encoding="utf-8") as f:
    f.write(dot + "\n")
for fmt, extra in (("svg", []), ("png", ["-Gdpi=110"])):
    subprocess.run(["neato", f"-T{fmt}", *extra, os.path.join(docs, "er_diagram.dot"),
                    "-o", os.path.join(docs, f"er_diagram.{fmt}")], check=True)
    print("wrote docs/er_diagram." + fmt)
