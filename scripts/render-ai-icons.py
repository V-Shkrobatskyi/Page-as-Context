# Copyright (c) 2026 Vitalii Shkrobatskyi
# SPDX-License-Identifier: GPL-3.0-only
"""Render the existing SVG geometry with a colored arrow (requires Pillow)."""
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SVG = ET.parse(ROOT / 'public/icon/page-as-context.svg')


def points(path):
    tokens = re.findall(r'[A-Za-z]|-?\d+(?:\.\d+)?', path)
    result, position, start = [], (0., 0.), (0., 0.)
    index, command = 0, ''
    while index < len(tokens):
        if tokens[index].isalpha():
            command = tokens[index]
            index += 1
        relative = command.islower()
        kind = command.upper()
        if kind == 'Z':
            result.append(start)
            position = start
            continue
        count = {'M': 2, 'L': 2, 'H': 1, 'V': 1, 'C': 6}[kind]
        values = list(map(float, tokens[index:index + count]))
        index += count
        x, y = position
        if kind in ('M', 'L'):
            position = (values[0] + (x if relative else 0), values[1] + (y if relative else 0))
            if kind == 'M':
                start = position
                command = 'l' if relative else 'L'
            result.append(position)
        elif kind == 'H':
            position = (values[0] + (x if relative else 0), y)
            result.append(position)
        elif kind == 'V':
            position = (x, values[0] + (y if relative else 0))
            result.append(position)
        else:
            controls = [(values[i] + (x if relative else 0), values[i + 1] + (y if relative else 0)) for i in range(0, 6, 2)]
            for step in range(1, 25):
                t = step / 24
                result.append(tuple((1-t)**3 * position[axis] + 3*(1-t)**2*t * controls[0][axis] + 3*(1-t)*t*t * controls[1][axis] + t**3 * controls[2][axis] for axis in (0, 1)))
            position = controls[-1]
    return result


for mode, color in [('read', '#FFFF00'), ('write', '#E60000')]:
    for size in (16, 32, 48, 96, 128):
        scale = size * 8 / 128
        image = Image.new('RGBA', (size * 8, size * 8))
        draw = ImageDraw.Draw(image)
        for path in SVG.iter('{http://www.w3.org/2000/svg}path'):
            arrow = path.get('transform') == 'translate(0 12)'
            polygon = [((x * 1.29 - 23.72) * scale, ((y + (12 if arrow else 0)) * 1.08 - 6.74) * scale) for x, y in points(path.attrib['d'])]
            draw.polygon(polygon, fill=color if arrow else path.attrib['fill'])
        image.resize((size, size), Image.Resampling.LANCZOS).save(ROOT / f'public/icon/ai-{mode}-{size}.png')
