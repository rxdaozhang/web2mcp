import re, sys, json
from bs4 import Tag, BeautifulSoup

ROLE_ACTIONABLES = {"button", "link"}
FOCUSABLE_TAGS = {"div", "span"}  # many apps use these as faux buttons/links

def norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())

def is_hidden(node: Tag) -> bool:
    if not isinstance(node, Tag):
        return True
    if node.name in ("script", "style", "template"):
        return True
    if node.has_attr("hidden"):
        return True
    if str(node.get("aria-hidden")).lower() == "true":
        return True
    style = (node.get("style") or "").replace(" ", "").lower()
    if "display:none" in style or "visibility:hidden" in style:
        return True
    return False

def is_actionable(node: Tag) -> bool:
    if not isinstance(node, Tag):
        return False
    # native
    if node.name == "a" and node.get("href"):
        return True
    if node.name == "button":
        return True
    # role-based
    role = (node.get("role") or "").lower()
    if role in ROLE_ACTIONABLES:
        return True
    # focusable faux-controls (e.g., Gmail Compose)
    if node.name in FOCUSABLE_TAGS:
        tabindex = node.get("tabindex")
        if tabindex is not None and str(tabindex).strip() != "-1":
            return True
    return False

def label_for(node: Tag) -> str:
    # prefer aria-label/title; else visible text
    for k in ("aria-label", "title"):
        v = norm(node.get(k))
        if v:
            return v
    return norm(node.get_text(" ", strip=True))

def extract_structure(node: Tag):
    if not isinstance(node, Tag) or is_hidden(node):
        return None

    # If this node is actionable, return its label as a string
    if is_actionable(node):
        lbl = label_for(node)
        # Only treat as actionable if it actually has a label
        if lbl:
            return lbl

    # Otherwise, it’s a container: recurse into children and build a list
    children = []
    for child in node.children:
        out = extract_structure(child)
        if out is not None:
            children.append(out)

    # If no actionable descendants were found, drop this branch
    if not children:
        return None

    return children

def clean_html(soup: BeautifulSoup):
    for t in soup(["script","style","template"]):
        t.decompose()

def is_str_list(x):
    return isinstance(x, list) and all(isinstance(y, str) for y in x)

def squash(node):
    # strings pass through
    if isinstance(node, str):
        return node

    if not isinstance(node, list):
        return node

    # 1) recursively squash children
    kids = [squash(c) for c in node if c not in ([], None)]

    # 2) collapse single-child list wrappers repeatedly
    changed = True
    while changed and len(kids) == 1 and isinstance(kids[0], list):
        kids = kids[0]
        changed = True

    # 3) inside the list, replace any child like [x] -> x (repeat until stable)
    def collapse_single_wrappers(lst):
        out = []
        for c in lst:
            while isinstance(c, list) and len(c) == 1 and isinstance(c[0], (str, list)):
                c = c[0]
            out.append(c)
        return out

    kids = collapse_single_wrappers(kids)

    # 4) merge consecutive children that are lists of strings: [..., ["a","b"], ["c"], ...] -> [..., ["a","b","c"], ...]
    merged = []
    for c in kids:
        if is_str_list(c) and merged and is_str_list(merged[-1]):
            merged[-1] = merged[-1] + c
        else:
            merged.append(c)
    kids = merged

    # 5) if the whole thing ended up as a single nested list again, unwrap once
    if len(kids) == 1 and isinstance(kids[0], list):
        return kids[0]

    return kids

def main(fp):
    html = open(fp, "r", encoding="utf-8").read()
    soup = BeautifulSoup(html, "html.parser")
    clean_html(soup)
    body = soup.body or soup
    structure = extract_structure(body)
    compressed = squash(structure)
    print(json.dumps(compressed, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python extract_links_buttons_nested.py input.html")
        sys.exit(1)
    main(sys.argv[1])
