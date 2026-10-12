from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
dest = root / 'extension' / 'icons'
dest.mkdir(parents=True, exist_ok=True)
size = 1024
image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((48, 48, 976, 976), radius=272, fill='#365fff')
draw.polygon([(320, 224), (592, 224), (752, 384), (752, 784), (320, 784)], fill='#f6f3eb')
draw.line([(592, 224), (592, 400), (752, 400)], fill='#365fff', width=48, joint='curve')
draw.rounded_rectangle((408, 504, 664, 552), radius=24, fill='#17283f')
draw.rounded_rectangle((408, 616, 600, 664), radius=24, fill='#17283f')
for icon_size in (16, 32, 48, 128):
    image.resize((icon_size, icon_size), Image.Resampling.LANCZOS).save(dest / f'icon{icon_size}.png')
print('Generated 16, 32, 48, and 128 pixel extension icons.')
