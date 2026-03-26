import os
import sys
import glob
from openai import OpenAI
from dotenv import load_dotenv

# Load API key from ../.env.local
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env.local'))

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

CLAIM_EXTRACTION_PROMPT = """You are analyzing an essay to extract its core argument structure.

Task:
Identify the 4–6 most important claims made in the essay.

Definition of a claim:
A claim is a distinct, meaningful proposition that contributes to the overall argument of the essay.

Instructions:
- Extract 4–6 claims only (no more, no fewer unless absolutely necessary).
- Each claim must represent a unique idea (no overlap or redundancy).
- Focus on central arguments, not examples, anecdotes, or supporting details.
- Maintain a consistent level of abstraction across all claims.
- Each claim should be expressed in one clear, concise, and readable sentence.
- Do NOT quote directly from the essay; paraphrase in neutral wording.
- Do NOT include sub-points or merge multiple ideas into one claim.

Output format:
Provide the claims as a numbered list.

Essay:
{essay_content}"""


def extract_claims(essay_content: str) -> str:
    """Extract 4-6 claims from an essay using GPT-4o."""
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "user", "content": CLAIM_EXTRACTION_PROMPT.format(essay_content=essay_content)}
        ],
        temperature=0.3,
    )
    return response.choices[0].message.content


def process_essays(dir_nums=None):
    """Process essays in ./data/XX directories.
    
    Args:
        dir_nums: List of directory numbers to process (e.g., ['07', '08']).
                  If None, processes all directories.
    """
    data_dir = os.path.join(os.path.dirname(__file__), 'data')

    if dir_nums:
        directories = [os.path.join(data_dir, d) for d in dir_nums]
        directories = [d for d in directories if os.path.isdir(d)]
    else:
        dir_pattern = os.path.join(data_dir, '[0-9][0-9]')
        directories = sorted(glob.glob(dir_pattern))

    if not directories:
        print("No directories found in ./data/")
        return

    for dir_path in directories:
        dir_name = os.path.basename(dir_path)  # e.g., "01"
        print(f"\nProcessing directory: {dir_name}")

        # Process both essays in the directory
        for essay_num in [1, 2]:
            essay_filename = f"{dir_name}-{essay_num}-essay.txt"
            essay_path = os.path.join(dir_path, essay_filename)

            if not os.path.exists(essay_path):
                print(f"  Skipping {essay_filename} (not found)")
                continue

            print(f"  Reading {essay_filename}...")
            with open(essay_path, 'r', encoding='utf-8') as f:
                essay_content = f.read()

            if not essay_content.strip():
                print(f"  Skipping {essay_filename} (empty)")
                continue

            print(f"  Extracting claims from {essay_filename}...")
            claims = extract_claims(essay_content)

            # Save claims to xx-N-essay-claims-preextracted.txt
            output_filename = f"{dir_name}-{essay_num}-essay-claims-preextracted.txt"
            output_path = os.path.join(dir_path, output_filename)

            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(claims)

            print(f"  Saved claims to {output_filename}")


if __name__ == "__main__":
    # Specify directory numbers as command-line args, e.g.:
    #   python essay-claim-extraction.py 07 08 09 11
    # Or run with no args to process all directories.
    if len(sys.argv) > 1:
        dir_nums = [arg.zfill(2) for arg in sys.argv[1:]]
    else:
        dir_nums = None
    process_essays(dir_nums)