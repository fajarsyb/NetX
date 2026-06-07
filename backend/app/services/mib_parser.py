import re

# Standard Root OID seeds
ROOT_OIDS = {
    "iso": "1",
    "org": "1.3",
    "dod": "1.3.6",
    "internet": "1.3.6.1",
    "directory": "1.3.6.1.1",
    "mgmt": "1.3.6.1.2",
    "mib-2": "1.3.6.1.2.1",
    "transmission": "1.3.6.1.2.1.10",
    "experimental": "1.3.6.1.3",
    "private": "1.3.6.1.4",
    "enterprises": "1.3.6.1.4.1",
    "security": "1.3.6.1.5",
    "snmpV2": "1.3.6.1.6",
    # Common Enterprise Roots
    "cisco": "1.3.6.1.4.1.9",
    "fortinet": "1.3.6.1.4.1.12356",
    "fnFortiGateMib": "1.3.6.1.4.1.12356.1",
    "alliedTelesis": "1.3.6.1.4.1.207",
    "juniperMIB": "1.3.6.1.4.1.2636",
    "ruijie": "1.3.6.1.4.1.4881"
}

def parse_mib_text(text: str) -> tuple[str, list[dict]]:
    """
    Parses a raw MIB text file to find the MIB Module name and all OBJECT-TYPE
    or OBJECT IDENTIFIER definitions.
    
    Returns (mib_name, list_of_objects)
    """
    # 1. Clean comments and whitespace
    clean_lines = []
    for line in text.splitlines():
        # Strip comments starting with '--'
        # Be careful not to break inside quoted strings, but for standard MIB comments this is usually safe
        if '--' in line:
            line = line.split('--')[0]
        clean_lines.append(line)
        
    clean_text = " ".join(clean_lines)
    
    # 2. Extract MIB Module Name
    # e.g., "IF-MIB DEFINITIONS ::= BEGIN"
    mib_name_match = re.search(r"(\S+)\s+DEFINITIONS\s*::=\s*BEGIN", clean_text, re.IGNORECASE)
    mib_name = mib_name_match.group(1) if mib_name_match else "UNKNOWN-MIB"
    
    # 3. Parse OBJECT-TYPE & OBJECT IDENTIFIER
    # e.g.:
    # name OBJECT-TYPE
    #    SYNTAX      Counter32
    #    MAX-ACCESS  read-only
    #    STATUS      current
    #    DESCRIPTION "My description"
    #    ::= { parent 12 }
    
    # We search for the pattern name followed by OBJECT-TYPE, OBJECT IDENTIFIER, MODULE-IDENTITY, etc.
    # capturing the body up to ::= { parent integer }
    pattern = r"(\w+)\s+([A-Z0-9\-]+|OBJECT\s+IDENTIFIER)\s+(.*?)::=\s*\{\s*(\w+)\s+(\d+)\s*\}"
    matches = re.finditer(pattern, clean_text, re.DOTALL | re.IGNORECASE)
    
    parsed_objects = []
    for m in matches:
        name = m.group(1)
        obj_type = m.group(2)
        body = m.group(3)
        parent = m.group(4)
        subid = m.group(5)
        
        syntax = ""
        description = ""
        
        if "object-type" in obj_type.lower():
            # Extract SYNTAX type (e.g. Counter32, DisplayString, Integer32)
            syntax_match = re.search(r"SYNTAX\s+(\S+)", body, re.IGNORECASE)
            if syntax_match:
                syntax = syntax_match.group(1)
                
            # Extract DESCRIPTION string
            descr_match = re.search(r"DESCRIPTION\s+\"(.*?)\"", body, re.DOTALL | re.IGNORECASE)
            if descr_match:
                description = descr_match.group(1).strip()
                # Clean up excess whitespace and spacing inside description
                description = re.sub(r"\s+", " ", description)
                
        parsed_objects.append({
            "name": name,
            "parent": parent,
            "subid": subid,
            "syntax": syntax,
            "description": description
        })
        
    return mib_name, parsed_objects

def resolve_mibs_oids(objects: list[dict], db_conn=None) -> list[dict]:
    """
    Attempts to resolve relative OIDs (e.g. parent='enterprises', subid='9')
    to absolute dotted OIDs using standard seeds, the current parsed objects,
    and the existing database records.
    """
    resolved = dict(ROOT_OIDS)
    
    # Load existing MIB objects from DB for cross-MIB resolution
    if db_conn:
        try:
            c = db_conn.cursor()
            c.execute("SELECT name, oid FROM snmp_mib_objects")
            for row in c.fetchall():
                resolved[row["name"]] = row["oid"]
        except Exception:
            pass
            
    unresolved = list(objects)
    resolved_list = []
    
    # Keep looping and resolving as long as we make progress in resolving parents
    progress = True
    while progress and unresolved:
        progress = False
        remaining = []
        for obj in unresolved:
            parent = obj["parent"]
            if parent in resolved:
                parent_oid = resolved[parent]
                obj_oid = f"{parent_oid}.{obj['subid']}"
                resolved[obj["name"]] = obj_oid
                
                # Save OID
                obj["oid"] = obj_oid
                resolved_list.append(obj)
                progress = True
            else:
                remaining.append(obj)
        unresolved = remaining
        
    # For any unresolved objects left (e.g., parent MIB isn't imported yet),
    # construct a relative path format (e.g., "parent.subid") which can be resolved later
    for obj in unresolved:
        obj["oid"] = f"{obj['parent']}.{obj['subid']}"
        resolved_list.append(obj)
        
    return resolved_list
