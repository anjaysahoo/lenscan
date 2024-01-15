import argparse
import logging
import os
import shutil
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import duckdb
import polars as pl
import schedule
from google.cloud import bigquery
from google.oauth2 import service_account

logging.basicConfig(level=logging.INFO)

# Initialize BigQuery client
service_account_path = "service_account.json"
credentials = service_account.Credentials.from_service_account_file(
    service_account_path
)
bqclient = bigquery.Client(credentials=credentials, project=credentials.project_id)


# Parse command line arguments
parser = argparse.ArgumentParser(description="Connect to DuckDB and export tables.")
parser.add_argument(
    "-i", "--input", help="Path to the input database file.", required=True
)
parser.add_argument(
    "-o", "--output", help="Path to the directory to which exports will be saved."
)
parser.add_argument(
    "-c",
    "--concurrency",
    help="Number of concurrent tasks.",
    type=int,
    default=1,
)
args = parser.parse_args()

dataset_ref = bqclient.dataset("v2_polygon", project="lens-public-data")
dataset = bqclient.get_dataset(dataset_ref)


is_task_running = False


def convert_schema(table_schema):
    converted_schema = []
    for field in table_schema:
        if field.field_type == "RECORD" and field.name == "datastream_metadata":
            for subfield in field.fields:
                if subfield.name == "source_timestamp":
                    converted_schema.append(f"{subfield.name} BIGINT")
        else:
            converted_schema.append(f"{field.name} {field.field_type}")
    return converted_schema


def create_output_directory():
    """
    Create a new directory with a timestamp in the specified location.
    Return the directory name.
    """
    date_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_directory = os.path.join(args.output, f"v2_polygon_{date_str}")
    os.makedirs(output_directory, exist_ok=True)
    logging.info(f"Output directory set to: {output_directory}")
    return output_directory


def update_symbolic_link(output_dir):
    """
    Update the symbolic link to the specified target directory.
    """
    symlink_path = os.path.join(args.output, "v2_polygon")
    if os.path.exists(symlink_path):
        if os.path.islink(symlink_path):
            os.unlink(symlink_path)
    os.symlink(os.path.abspath(output_dir), symlink_path)
    logging.info(f"Symbolic link updated to: {output_dir}")


def export_tables(conn, output_dir):
    """
    Export all tables to Parquet files in the given directory.
    """
    try:
        # Retrieve a list of all tables
        tables = conn.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'"
        ).fetchall()

        if not tables:
            logging.info("No tables found in the database.")
            return

        total_tables = len(tables)
        logging.info(f"Found {total_tables} tables.")

        # Export each table to a Parquet file
        for index, table in enumerate(tables, start=1):
            table_name = table[0]
            parquet_file_path = os.path.join(output_dir, f"{table_name}.parquet")
            conn.execute(
                f"COPY {table_name} TO '{parquet_file_path}' (FORMAT 'parquet')"
            )
            logging.info(
                f"Exported table {index}/{total_tables}: {table_name} to {parquet_file_path}"
            )

    except Exception as e:
        logging.error(f"An error occurred: {e}")


def delete_old_dir():
    """
    Delete the old directories that are not linked by the symbolic link.
    """
    symlink_path = os.path.join(args.output, "v2_polygon")
    cur_link_target = os.path.realpath(symlink_path)
    parent_dir = os.path.dirname(cur_link_target)
    for item in os.listdir(parent_dir):
        dir_path = os.path.join(parent_dir, item)
        if (
            os.path.isdir(dir_path)
            and item.startswith("v2_polygon_")
            and os.path.abspath(dir_path) != cur_link_target
        ):
            shutil.rmtree(dir_path)
            logging.info(f"Deleted old directory: {dir_path}")


def process_table(table, conn, dataset_ref, bqclient, idx):
    table_id = table.table_id
    table_ref = dataset_ref.table(table_id)

    cursor = conn.cursor()

    # Check if table exists in DuckDB
    cursor.execute(
        f"SELECT count(*) FROM information_schema.tables WHERE table_name = '{table_id}'"
    )
    if cursor.fetchone()[0] == 0:
        # Create table in DuckDB
        logging.info(f"Creating table: {table_id}")
        table_schema = bqclient.get_table(table_ref).schema
        converted_schema = convert_schema(table_schema)
        ddl = f"CREATE TABLE {table_id} ({', '.join(converted_schema)})"
        cursor.execute(ddl)

    # Retrieve and sync data
    last_timestamp_result = cursor.execute(
        f"SELECT MAX(source_timestamp) FROM {table_id}"
    ).fetchone()
    last_timestamp = (
        last_timestamp_result[0] if last_timestamp_result[0] is not None else 0
    )

    # Build and execute query
    fields = [
        f.name
        if f.name != "datastream_metadata"
        else "datastream_metadata.source_timestamp"
        for f in table_schema
    ]
    query = f"""
    SELECT {', '.join(fields)}
    FROM `{table_ref}`
    WHERE datastream_metadata.source_timestamp > {last_timestamp}
    ORDER BY datastream_metadata.source_timestamp ASC
    """
    query_job = bqclient.query(query)
    pageNum = 0
    for page in query_job.result(page_size=10000).pages:
        pageNum += 1
        items = list(page)
        if items:
            df = pl.DataFrame(
                {
                    field.name: list(data)
                    for field, data in zip(table_schema, zip(*items))
                }
            )
            cursor.register("df", df)
            cursor.execute(f"INSERT INTO {table_id} SELECT * FROM df")
            logging.info(
                f"Synced table {idx}: {table_id} - page {pageNum} - {len(items)} rows"
            )
    logging.info(f"Synced table {idx}: {table_id}")


def perform_sync_task():
    global is_task_running

    if is_task_running:
        logging.info("Another sync task is already running. Skipping this cycle.")
        return

    is_task_running = True
    logging.info("Starting data sync...")

    with duckdb.connect(database=args.input) as conn:
        try:
            tables = list(bqclient.list_tables(dataset))
            logging.info(f"Found {len(tables)} tables in BigQuery.")

            with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
                for idx, table in enumerate(tables, start=1):
                    executor.submit(
                        process_table, table, conn, dataset_ref, bqclient, idx
                    )

            if args.output:
                output_directory = create_output_directory()
                export_tables(conn, output_directory)
                update_symbolic_link(output_directory)
                delete_old_dir()

            logging.info(f"Synced {len(tables)} tables.")

        except Exception as e:
            logging.error(f"An error occurred: {e}")
        finally:
            is_task_running = False


# Schedule the task to run every 60 minutes
schedule.every(12).hours.do(perform_sync_task)

# Run the task immediately on start
perform_sync_task()

# Run the scheduler
while True:
    schedule.run_pending()
    time.sleep(1)
