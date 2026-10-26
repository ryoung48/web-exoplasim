import re

DECLARATION = re.compile(r"^\s*(real|integer)(\s*\(\s*kind\s*=\s*\d\s*\))?((?:\s*,\s*\w+)*)\s*(::)?\s*(.+)$", re.I)
PARAMETER = re.compile(r"^\s*parameter\s*\((.+)\)\s*$", re.I)


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
    body = re.search(rf"^\s*module\s+{module}\b(.*?)^\s*end\s+module", text, re.I | re.M | re.S).group(1)
    variables = []
    for statement in statements(body):
        parameter = PARAMETER.match(statement)
        if parameter:
            for entity in entities(parameter.group(1)):
                variables.append({"name": entity.split("=")[0].strip(), "array": False, "allocatable": False, "constant": True})
            continue
        declaration = DECLARATION.match(statement)
        if not declaration:
            continue
        attributes = declaration.group(3).lower()
        for entity in entities(declaration.group(5)):
            name = re.match(r"(\w+)", entity).group(1)
            if "parameter" in attributes:
                variables.append({"name": name, "array": False, "allocatable": False, "constant": True})
            else:
                shape = re.match(r"\w+\s*(\()", entity)
                variables.append({"name": name, "array": bool(shape) or "dimension" in attributes, "allocatable": "allocatable" in attributes,
                                  "constant": False, "integer": declaration.group(1).lower() == "integer"})
    return variables


def continued(statement: str) -> str:
    # Free-form continuation that resumes after a leading & may split any
    # token, so no space may precede the trailing &.
    return f"      {statement[:60]}" + "".join(f"&\n     &{statement[i:i + 60]}" for i in range(60, len(statement), 60))


def state_dump_source(variables: list) -> str:
    lines = ["      subroutine gcm_probe_state_dump", "      use pumamod"]
    for variable in variables:
        name = variable["name"]
        if variable["array"]:
            call = f"call gcm_probe_write(95, '{name}', real(reshape({name}, [size({name})])), size({name}))"
            if variable["allocatable"]:
                call = f"if (allocated({name})) {call}"
        else:
            call = f"call gcm_probe_write(95, '{name}', [1.0 * real({name})], 1)"
        lines.append(continued(call))
    lines.append("      end subroutine gcm_probe_state_dump")
    return "\n".join(lines) + "\n"


def state_load_source(variables: list) -> str:
    # Reads a dump written by gcm_probe_state_dump in the same order, already
    # converted to this build's default real. Named constants are read and
    # discarded, so dumps of the same source from another build line up.
    lines = ["      subroutine gcm_probe_state_load(kunit)", "      use pumamod", "      integer, intent(in) :: kunit", "      real, allocatable :: z(:)"]
    for variable in variables:
        name = variable["name"]
        if variable["constant"]:
            statements = [f"allocate(z(1))", "read(kunit) z", "deallocate(z)"]
        elif variable["array"]:
            convert = f"nint(reshape(z, shape({name})))" if variable["integer"] else f"real(reshape(z, shape({name})), kind({name}))"
            statements = [f"allocate(z(size({name})))", "read(kunit) z", f"{name} = {convert}", "deallocate(z)"]
            if variable["allocatable"]:
                statements = [f"if (allocated({name})) then", *statements, "endif"]
        else:
            convert = "nint(z(1))" if variable["integer"] else f"real(z(1), kind({name}))"
            statements = ["allocate(z(1))", "read(kunit) z", f"{name} = {convert}", "deallocate(z)"]
        lines.extend(continued(statement) for statement in statements)
    lines.append("      end subroutine gcm_probe_state_load")
    return "\n".join(lines) + "\n"
