import os
from PIL import Image

MASTER_PATH = 'frontend/public/branding/source/phantoms-logo-master.png'
os.makedirs('frontend/public/branding', exist_ok=True)
os.makedirs('frontend/public/icons', exist_ok=True)

master = Image.open(MASTER_PATH).convert('RGBA')

def make_square_icon(master_img, target_size, padding_ratio=0.10, bg_color=None):
    """
    Fits master_img into a target_size x target_size square with given padding and optional bg color.
    """
    canvas = Image.new('RGBA', (target_size, target_size), bg_color or (0, 0, 0, 0))
    usable_size = int(target_size * (1.0 - 2 * padding_ratio))
    
    w, h = master_img.size
    scale = min(usable_size / w, usable_size / h)
    new_w, new_h = int(w * scale), int(h * scale)
    
    resized = master_img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    offset_x = (target_size - new_w) // 2
    offset_y = (target_size - new_h) // 2
    canvas.paste(resized, (offset_x, offset_y), resized)
    return canvas

# 1. Branding derivatives in frontend/public/branding
print("Generating branding derivatives...")
mark_512 = make_square_icon(master, 512, padding_ratio=0.04)
mark_512.save('frontend/public/branding/phantoms-mark.png', 'PNG')
mark_512.save('frontend/public/branding/phantoms-mark-512.png', 'PNG')

mark_192 = make_square_icon(master, 192, padding_ratio=0.04)
mark_192.save('frontend/public/branding/phantoms-mark-192.png', 'PNG')

mark_64 = make_square_icon(master, 64, padding_ratio=0.04)
mark_64.save('frontend/public/branding/phantoms-mark-64.png', 'PNG')

# 2. PWA icons in frontend/public/icons
print("Generating PWA icons...")
pwa_192 = make_square_icon(master, 192, padding_ratio=0.10)
pwa_192.save('frontend/public/icons/icon-192.png', 'PNG')

pwa_512 = make_square_icon(master, 512, padding_ratio=0.10)
pwa_512.save('frontend/public/icons/icon-512.png', 'PNG')

# 3. Favicon
print("Generating Favicons...")
fav_32 = make_square_icon(master, 32, padding_ratio=0.02)
fav_32.save('frontend/public/favicon.png', 'PNG')

fav_16 = make_square_icon(master, 16, padding_ratio=0.02)
fav_48 = make_square_icon(master, 48, padding_ratio=0.02)
fav_32.save('frontend/public/favicon.ico', format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])

# 4. Android Launcher Icons (mipmap)
# Android standard sizes: mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192
# Adaptive foreground standard sizes: mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432
print("Generating Android Launcher icons...")
mipmap_configs = [
    ('mdpi', 48, 108),
    ('hdpi', 72, 162),
    ('xhdpi', 96, 216),
    ('xxhdpi', 144, 324),
    ('xxxhdpi', 192, 432),
]

for density, icon_sz, fg_sz in mipmap_configs:
    d_dir = f'frontend/android/app/src/main/res/mipmap-{density}'
    os.makedirs(d_dir, exist_ok=True)
    
    # Square launcher (with subtle black round rect or transparent)
    sq_icon = make_square_icon(master, icon_sz, padding_ratio=0.05, bg_color=(11, 11, 11, 255))
    sq_icon.save(os.path.join(d_dir, 'ic_launcher.png'), 'PNG')
    
    # Round launcher
    rd_canvas = Image.new('RGBA', (icon_sz, icon_sz), (0, 0, 0, 0))
    from PIL import ImageDraw
    mask = Image.new('L', (icon_sz, icon_sz), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, icon_sz, icon_sz), fill=255)
    bg_circle = Image.new('RGBA', (icon_sz, icon_sz), (11, 11, 11, 255))
    rd_canvas.paste(bg_circle, (0, 0), mask)
    
    # paste mark inside circle
    emblem_in_circle = make_square_icon(master, icon_sz, padding_ratio=0.12)
    rd_canvas.paste(emblem_in_circle, (0, 0), emblem_in_circle)
    rd_canvas.save(os.path.join(d_dir, 'ic_launcher_round.png'), 'PNG')
    
    # Adaptive foreground (25% padding for safe area)
    fg_icon = make_square_icon(master, fg_sz, padding_ratio=0.22)
    fg_icon.save(os.path.join(d_dir, 'ic_launcher_foreground.png'), 'PNG')

# 5. Splash Screens
# Phantom Black #0B0B0B with centered emblem
print("Generating Splash Screens...")
def make_splash(target_w, target_h, emblem_size):
    splash = Image.new('RGBA', (target_w, target_h), (11, 11, 11, 255))
    emblem = make_square_icon(master, emblem_size, padding_ratio=0.0)
    ox = (target_w - emblem_size) // 2
    oy = (target_h - emblem_size) // 2
    splash.paste(emblem, (ox, oy), emblem)
    return splash

splash_web = make_splash(1080, 1920, 360)
splash_web.save('frontend/public/splash.png', 'PNG')

splash_drawable = make_splash(1080, 1920, 360)
splash_drawable.save('frontend/android/app/src/main/res/drawable/splash.png', 'PNG')

# Port drawables
port_sizes = [
    ('mdpi', 320, 480, 160),
    ('hdpi', 480, 800, 240),
    ('xhdpi', 720, 1280, 320),
    ('xxhdpi', 960, 1600, 400),
    ('xxxhdpi', 1280, 1920, 480),
]
for density, w, h, em_sz in port_sizes:
    d = f'frontend/android/app/src/main/res/drawable-port-{density}'
    os.makedirs(d, exist_ok=True)
    sp = make_splash(w, h, em_sz)
    sp.save(os.path.join(d, 'splash.png'), 'PNG')

# Land drawables
land_sizes = [
    ('mdpi', 480, 320, 160),
    ('hdpi', 800, 480, 240),
    ('xhdpi', 1280, 720, 320),
    ('xxhdpi', 1600, 960, 400),
    ('xxxhdpi', 1920, 1280, 480),
]
for density, w, h, em_sz in land_sizes:
    d = f'frontend/android/app/src/main/res/drawable-land-{density}'
    os.makedirs(d, exist_ok=True)
    sp = make_splash(w, h, em_sz)
    sp.save(os.path.join(d, 'splash.png'), 'PNG')

print("All brand assets generated successfully!")

