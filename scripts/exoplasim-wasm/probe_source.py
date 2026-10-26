import re

DECLARATION = re.compile(r"^\s*(real|integer)(\s*\(\s*kind\s*=\s*\d\s*\))?((?:\s*,\s*\w+(?:\s*\([^)]*\))?)*)\s*(::)?\s*(.+)$", re.I)
PARAMETER = re.compile(r"^\s*parameter\s*\((.+)\)\s*$", re.I)
NEWLINE = chr(10)


def statements(text: str) -> list:
    lines = []
    pending = ""
    for raw in text.splitlines():
        line = raw.split("!", 1)[0].rstrip()
        if not line.strip():
            continue
        if pending:
            line = pending + " " + line.lstrip().lstrip("&")
            pending = ""
        if line.endswith("&"):
            pending = line[:-1]
            continue
        lines.append(line)
    return lines


def entities(listing: str) -> list:
    parts = []
    depth = 0
    current = ""
    for character in listing:
        if character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
        if character == "," and depth == 0:
            parts.append(current)
            current = ""
        else:
            current += character
    parts.append(current)
    return [part.strip() for part in parts if part.strip()]


def module_variables(text: str, module: str) -> list:
    body = re.search(rf"^\s*module\s+{module}\s*$(.*?)^\s*end\s+module", text, re.I | re.M | re.S).group(1)
    variables = []
    for statement in statements(body):
        parameter = PARAMETER.match(statement)
        if parameter:
            for entity in entities(parameter.group(1)):
                variables.append({"name": entity.split("=")[0].strip(), "array": False, "allocatable": False, "constant": True, "integer": False})
            continue
        declaration = DECLARATION.match(statement)
        if not declaration:
            continue
        attributes = declaration.group(3).lower()
        for entity in entities(declaration.group(5)):
            name = re.match(r"(\w+)", entity).group(1)
            shape = re.match(r"\w+\s*(\()", entity)
            variables.append({"name": name, "array": bool(shape) or "dimension" in attributes, "allocatable": "allocatable" in attributes,
                              "constant": "parameter" in attributes, "integer": declaration.group(1).lower() == "integer"})
    return variables


def continued(statement: str) -> str:
    # Free-form continuation that resumes after a leading & may split any
    # token, so no space may precede the trailing &.
    return f"      {statement[:60]}" + "".join(f"&{NEWLINE}     &{statement[i:i + 60]}" for i in range(60, len(statement), 60))


def dump_source(module: str, variables: list) -> str:
    # pumamod variables keep their names; other modules' are <module>.<name>.
    prefix = "" if module == "pumamod" else f"{module}."
    lines = [f"      subroutine gcm_probe_dump_{module}", f"      use {module}"]
    for variable in variables:
        name = variable["name"]
        if variable["array"]:
            call = f"call gcm_probe_write(95, '{prefix}{name}', real(reshape({name}, [size({name})])), size({name}))"
            if variable["allocatable"]:
                call = f"if (allocated({name})) {call}"
        else:
            call = f"call gcm_probe_write(95, '{prefix}{name}', [1.0 * real({name})], 1)"
        lines.append(continued(call))
    lines.append(f"      end subroutine gcm_probe_dump_{module}")
    return NEWLINE.join(lines) + NEWLINE


def load_source(module: str, variables: list) -> str:
    # Reads a dump written by dump_source in the same order, already
    # converted to this build's default real. Named constants are read and
    # discarded, so dumps of the same source from another build line up.
    lines = [f"      subroutine gcm_probe_load_{module}(kunit)", f"      use {module}", "      integer, intent(in) :: kunit", "      real, allocatable :: z(:)"]
    for variable in variables:
        name = variable["name"]
        count = f"size({name})" if variable["array"] else "1"
        if variable["constant"]:
            body = [f"allocate(z({count}))", "read(kunit) z", "deallocate(z)"]
        elif variable["array"]:
            convert = f"nint(reshape(z, shape({name})))" if variable["integer"] else f"real(reshape(z, shape({name})), kind({name}))"
            body = [f"allocate(z({count}))", "read(kunit) z", f"{name} = {convert}", "deallocate(z)"]
            if variable["allocatable"]:
                body = [f"if (allocated({name})) then", *body, "endif"]
        else:
            convert = "nint(z(1))" if variable["integer"] else f"real(z(1), kind({name}))"
            body = ["allocate(z(1))", "read(kunit) z", f"{name} = {convert}", "deallocate(z)"]
        lines.extend(continued(statement) for statement in body)
    lines.append(f"      end subroutine gcm_probe_load_{module}")
    return NEWLINE.join(lines) + NEWLINE


def state_source(modules: dict) -> str:
    # modules maps each module name to its variables, in dump order.
    parts = [dump_source(module, variables) + load_source(module, variables) for module, variables in modules.items()]
    dump = ["      subroutine gcm_probe_state_dump", *[f"      call gcm_probe_dump_{module}" for module in modules], "      end subroutine gcm_probe_state_dump"]
    load = ["      subroutine gcm_probe_state_load(kunit)", "      integer, intent(in) :: kunit", *[f"      call gcm_probe_load_{module}(kunit)" for module in modules], "      end subroutine gcm_probe_state_load"]
    return "".join(parts) + NEWLINE.join(dump + load) + NEWLINE
