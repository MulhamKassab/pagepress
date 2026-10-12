from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
dest = root / 'extension' / 'icons'
dest.mkdir(parents=True, exist_ok=True)

def draw_icon(store_padding=False):
    image = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    scale = 768 / 928 if store_padding else 1
    def coordinate(value):
        return 128 + (value - 48) * scale if store_padding else value
    def box(values):
        return tuple(coordinate(value) for value in values)
    def points(values):
        return [(coordinate(x), coordinate(y)) for x, y in values]
    draw.rounded_rectangle(box((48, 48, 976, 976)), radius=272 * scale, fill='#365fff')
    draw.polygon(points([(320, 224), (592, 224), (752, 384), (752, 784), (320, 784)]), fill='#f6f3eb')
    draw.line(points([(592, 224), (592, 400), (752, 400)]), fill='#365fff', width=round(48 * scale), joint='curve')
    draw.rounded_rectangle(box((408, 504, 664, 552)), radius=24 * scale, fill='#17283f')
    draw.rounded_rectangle(box((408, 616, 600, 664)), radius=24 * scale, fill='#17283f')
    return image

for icon_size in (16, 32, 48, 128):
    # Chrome Web Store's square icon uses 96px artwork and 16px padding per side.
    draw_icon(store_padding=icon_size == 128).resize((icon_size, icon_size), Image.Resampling.LANCZOS).save(dest / f'icon{icon_size}.png')
print('Generated extension icons; the 128px icon has store-sized transparent padding.')
