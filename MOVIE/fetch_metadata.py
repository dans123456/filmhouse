import csv
import json
import urllib.request
import urllib.parse
import time
import os

API_KEY = "a3a9df05cdacd9f23c885f2756466395"
CSV_PATH = r"c:\Users\SWAGAAA\Desktop\fimlhouse\MOVIE\Data\movies.csv"
OUTPUT_PATH = r"c:\Users\SWAGAAA\Desktop\fimlhouse\MOVIE\Data\movies_metadata.json"

def fetch_json(url):
    time.sleep(0.1) # Sleep to avoid rate limiting
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return None

def get_movie_details(tmdb_id):
    url = f"https://api.themoviedb.org/3/movie/{tmdb_id}?api_key={API_KEY}&append_to_response=credits,videos"
    data = fetch_json(url)
    if data and 'id' in data:
        data['media_type'] = 'movie'
        return data
    return None

def get_tv_details(tmdb_id):
    url = f"https://api.themoviedb.org/3/tv/{tmdb_id}?api_key={API_KEY}&append_to_response=credits,videos"
    data = fetch_json(url)
    if data and 'id' in data:
        data['media_type'] = 'tv'
        return data
    return None

def search_multi(query):
    encoded_query = urllib.parse.quote(query)
    url = f"https://api.themoviedb.org/3/search/multi?api_key={API_KEY}&query={encoded_query}"
    data = fetch_json(url)
    if data and data.get('results'):
        return data['results'][0]
    return None

def get_genres(details):
    if not details:
        return []
    return [g['name'] for g in details.get('genres', [])]

def get_countries(details):
    if not details:
        return []
    if details.get('media_type') == 'movie':
        return [c['iso_3166_1'] for c in details.get('production_countries', [])]
    else:
        return [c for c in details.get('origin_country', [])]

def get_cast(details):
    if not details or 'credits' not in details:
        return []
    cast_list = details['credits'].get('cast', [])
    return [member['name'] for member in cast_list[:5]]

def get_director_or_creator(details):
    if not details:
        return ""
    if details.get('media_type') == 'movie':
        crew = details.get('credits', {}).get('crew', [])
        directors = [member['name'] for member in crew if member.get('job') == 'Director']
        return directors[0] if directors else ""
    else:
        creators = details.get('created_by', [])
        return creators[0]['name'] if creators else ""

def get_trailer_key(details):
    if not details or 'videos' not in details:
        return ""
    videos = details['videos'].get('results', [])
    for video in videos:
        if video.get('site') == 'YouTube' and video.get('type') == 'Trailer':
            return video.get('key')
    # Fallback to any YouTube video if no trailer
    for video in videos:
        if video.get('site') == 'YouTube':
            return video.get('key')
    return ""

def classify_categories(details, row_title, row_type):
    categories = ["Main"]
    
    # 1. Determine title and types
    title = ""
    release_year = 0
    orig_lang = "en"
    countries = []
    genres = []
    media_type = "movie"
    
    if details:
        title = details.get('title') or details.get('name') or ""
        media_type = details.get('media_type', 'movie')
        orig_lang = details.get('original_language', 'en')
        countries = get_countries(details)
        genres = get_genres(details)
        
        date_str = details.get('release_date') or details.get('first_air_date') or ""
        if date_str and len(date_str) >= 4:
            try:
                release_year = int(date_str[:4])
            except:
                pass
    else:
        title = row_title
        media_type = 'tv' if 'series' in row_type.lower() else 'movie'
        
    title_lower = title.lower()
    
    # Category Mappings
    
    # 1. Erotic Movies
    erotic_titles = ["365 days", "fifty shades", "fatal seduction", "sex education", "erotic"]
    if any(et in title_lower for et in erotic_titles):
        categories.append("Erotic Movies")
        
    # 2. Korean Drama
    if orig_lang == "ko" or "korean" in title_lower or any(k in title_lower for k in ["boys over flowers", "squid game"]):
        categories.append("Korean Drama")
        
    # 3. Bollywood
    if orig_lang in ["hi", "te", "ta", "ml", "kn"] or "IN" in countries or "bollywood" in title_lower:
        categories.append("Bollywood")
        
    # 4. African
    african_countries = ["ZA", "NG", "GH", "KE", "EG", "MA", "ET"]
    is_african_country = any(ac in countries for ac in african_countries)
    if is_african_country or any(at in title_lower for at in ["yolo", "blood and water", "blood & water", "supacell"]):
        categories.append("African")
        
    # 5. Anime
    if "JP" in countries and "Animation" in genres:
        categories.append("Anime")
    elif "anime" in title_lower:
        categories.append("Anime")
        
    # 6. Animated Movies
    if "Animation" in genres and media_type == 'movie':
        categories.append("Animated Movies")
        
    # 7. Kids Shows and Movies (Nickelodeon and Disney)
    kids_keywords = [
        "drake and josh", "henry danger", "sam and cat", "thundermans", 
        "victorious", "zoey 101", "nicky ricky", "gravity falls", 
        "baymax", "casagrandes", "carrossel", "loud house", 
        "phineas and ferb", "nickelodeon", "disney", "icarly", "matilda", "jessie"
    ]
    if "Family" in genres or "Kids" in genres or any(kk in title_lower for kk in kids_keywords):
        categories.append("Kids Shows and Movies (Nickelodeon and Disney)")
        
    # 8. Classic Movies
    if release_year > 0 and release_year < 2000:
        categories.append("Classic Movies")
        
    # 9. Comics and Manga
    comic_keywords = [
        "daredevil", "echo", "iron fist", "invincible", "the boys", 
        "gen v", "black adam", "shazam", "superman", "avatar the last airbender",
        "marvel", "dc comics", "punisher", "spider-man", "batman"
    ]
    if any(ck in title_lower for ck in comic_keywords):
        categories.append("Comics and Manga")
        
    # 10. Default Hollywood/British Movies & Series
    # If not already in major regional categories
    is_regional = any(cat in categories for cat in ["Korean Drama", "Bollywood", "African", "Anime"])
    if not is_regional:
        if media_type == 'tv' or 'series' in row_type.lower():
            categories.append("Hollywood/British Series")
        else:
            categories.append("Hollywood/British Movies")
            
    return categories

def main():
    print("Reading CSV and starting metadata fetching...")
    enriched_movies = []
    
    if not os.path.exists(CSV_PATH):
        print(f"Error: CSV file not found at {CSV_PATH}")
        return
        
    with open(CSV_PATH, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        header = next(reader)
        
        for idx, row in enumerate(reader):
            if not row:
                continue
            movie_id_str = row[0].strip()
            row_title = row[1].strip()
            row_type = row[2].strip()
            links = [link.strip() for link in row[3:] if link.strip()]
            
            print(f"[{idx+1}] Processing: ID={movie_id_str}, Title={row_title}")
            
            details = None
            
            # Try to fetch using ID if present
            if movie_id_str and movie_id_str.isdigit():
                tmdb_id = int(movie_id_str)
                # Try TV first if classified as Series
                if 'series' in row_type.lower() or 'cartoon' in row_type.lower():
                    details = get_tv_details(tmdb_id)
                    if not details:
                        details = get_movie_details(tmdb_id)
                else:
                    details = get_movie_details(tmdb_id)
                    if not details:
                        details = get_tv_details(tmdb_id)
            
            # Try to search if ID was invalid/missing or if title was null
            if (not details) and row_title and row_title.lower() != 'null':
                search_res = search_multi(row_title)
                if search_res:
                    tmdb_id = search_res.get('id')
                    media_type = search_res.get('media_type', 'movie')
                    if media_type == 'tv':
                        details = get_tv_details(tmdb_id)
                    else:
                        details = get_movie_details(tmdb_id)
            
            # Format poster and backdrop paths
            poster = ""
            backdrop = ""
            overview = "No synopsis available."
            rating = 0.0
            release_date = ""
            original_lang = "en"
            genres = []
            cast = []
            director = ""
            trailer = ""
            runtime = ""
            title = row_title
            
            if details:
                title = details.get('title') or details.get('name') or row_title
                overview = details.get('overview') or overview
                rating = details.get('vote_average') or rating
                original_lang = details.get('original_language') or original_lang
                
                release_date = details.get('release_date') or details.get('first_air_date') or ""
                
                if details.get('poster_path'):
                    poster = f"https://image.tmdb.org/t/p/w500{details['poster_path']}"
                if details.get('backdrop_path'):
                    backdrop = f"https://image.tmdb.org/t/p/w1280{details['backdrop_path']}"
                    
                genres = get_genres(details)
                cast = get_cast(details)
                director = get_director_or_creator(details)
                trailer = get_trailer_key(details)
                media_type = details.get('media_type', 'movie')
                
                # Runtime
                if details.get('runtime'):
                    runtime = f"{details['runtime']} min"
                elif details.get('episode_run_time') and len(details['episode_run_time']) > 0:
                    runtime = f"{details['episode_run_time'][0]} min"
            else:
                # Fallback empty properties
                media_type = 'tv' if 'series' in row_type.lower() else 'movie'
                
            categories = classify_categories(details, row_title, row_type)
            
            # Fallback images
            if not poster:
                poster = "img/FilmHouse3_nobg.png" # App Logo as default
            if not backdrop:
                backdrop = "img/FilmHouse.png" # Backdrop placeholder
                
            movie_entry = {
                "csv_id": movie_id_str,
                "tmdb_id": details.get('id') if details else None,
                "title": title,
                "type": "Series" if media_type == 'tv' else "Movie",
                "categories": categories,
                "genres": genres,
                "overview": overview,
                "poster": poster,
                "backdrop": backdrop,
                "rating": round(rating, 1),
                "release_date": release_date,
                "language": original_lang,
                "cast": cast,
                "director": director,
                "trailer": trailer,
                "runtime": runtime,
                "links": links
            }
            
            enriched_movies.append(movie_entry)
            
    # Write to output file
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as out_f:
        json.dump(enriched_movies, out_f, indent=2, ensure_ascii=False)
        
    print(f"Success! Enriched data written to {OUTPUT_PATH}. Processed {len(enriched_movies)} items.")

if __name__ == "__main__":
    main()
