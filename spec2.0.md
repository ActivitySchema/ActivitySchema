Version: 2.0

Table of Contents
=================
  
  - [Introduction](#introduction)
  - [Why Activity Schema 2.0](#why-activity-schema-2-0)
  - [Conceptual Overview](#conceptual-overview)
  	- [Entities](#entities)
  	- [Activities](#activities)
  	- [Metadata](#metadata)
  - [Structure](#structure)
  	- [Tables](#tables)
  	- [Activity Stream](#activity-stream)
  	- [Entity Table](#entity-table)
  	- [Additional Metadata](#additional-metadata)
  - [Using an Activity Schema](#using-an-activity-schema)
  	- [Modeling](#modeling)
  	- [Querying](#querying)
  - [Known Activity Schema Implementations](#known-activity-schema-implementations)

# Introduction

The activity schema is a new data modeling paradigm designed for modern data warehouses. It was created and implemented by [Ahmed Elsamadisi](https://www.linkedin.com/in/elsamadisi/) at [Narrator](https://www.narrator.ai).


This is a new standard for data to enable:
1. A standard in data modeling accross industry, sector and use-case
2. A simpler structure that is easily understandable 
3. A warehouse-naitive solution to behavior data.


<br>
<br>

The activity schema aims for these design goals

- **only one definition for each concept** - know exactly where to find the right data
- **single model layer** - no layers of dependencies
- **simple definitions** - no thousand-line SQL queries to model data
- **no relationships in the modeling laye**r - all concepts are defined independently of each other
- **no foreign key joins -** all concepts can be joined together without having to identify how they relate in advance
- **analyses can be run anywhere** — analyses can be shared and reused across companies with vastly different data.
- **high performance** - reduced joins and fewer columns leverages the power of modern column-oriented data warehouses
- **incremental updates** - no more rebuilding data models on every update
- **dynamically queried at analysis time** - create any table that you need at the moment you are using it

<br>


At its core an activity schema consists of transforming raw tables into a single, time series table called an activity stream. All downstream plots, tables, materialized views, etc used for BI are built **directly** from that single table, with no other dependencies. 

![image](https://user-images.githubusercontent.com/1216989/113028328-21cafc80-9159-11eb-972c-34d3617eb379.png)


<br>


The diagram above is the entire dependency graph: only three layers and a single data model. The modeling layer is able to create any kind of aggregation or table needed, and the consistent table structure allows data analyses to be written once and reused elsewhere. 


<br>
<br>



# Why Activity Schema 2.0

When we first designed the Activity schema it was 2016 and the data landscape was very different.  As we pushed for the Activity Schema and saw many use-cases on many warehouse we have learned a lot. 

<br>


### Features JSON

In V1 we had used `feature_1`, `feature_2`, `feature_3` as the feature columns.  This was simple, finite and worked on most warehouses.  In practice, we found that 3 features worked for 90% of activities so that was good enought. 

Over the years warehouses have gotten a lot more powerful and thier support for unstructured data is now ready to be used.  This lead us to move to a `feature_json` column to capture all the features.



### Multiple Tables

In V1, we put all the data into a single table the Activity Stream.  We depended on warehouse's partitioning to deal with the different tables. This was tested on Billions of rows and it worked very well. 

In V2, we now support a table per activity.  This was mainly to reduce BigQuery costs and improve its speed.  BigQuery is super popular but only supports partitioning over time, so we now support manual partitions.



### Dim tables

In V1, We were really focused on adding dimensions via only `activity_id` which didn't play well with dim tables that were already in the warehouse.  We realized this wasn't the best. 

In v2, any column in the `feature_json` can now be an `id` that joins to any of your dim tables



<br>
<br>


# Conceptual Overview

An activity schema models an **entity** taking a sequence of **activities** over time. 
For example, a **customer** (entity) **viewed a web page** (activity). 

An activity schema is implemented as a single, time series table with (optionally) a table per activity.

Each row in the table represents a single activity taken by the entity at a point in time. In other words, it has an activity identifier, an entity identifier, a timestamp, and some basic metadata called features. The specific structure is covered in the next section.

![schema_table](https://user-images.githubusercontent.com/1216989/113030867-0b727000-915c-11eb-8523-0da2f4411af0.png)


<br>


## **Entities**

Entities are the subject, or actor in the data. Every activity in the activity schema is an action taken by a specific entity with a unique identifier

The most common entity is a **customer**, but there can be other types as well. For example, a bike-sharing company could also have a **bike** entity to analyze things like repair frequency, mileage over time, etc. 

An activity schema table will only have one entity type and is typically named `<entity>_stream`. For example, an activity schema implementation for customers would be  `customer_stream`, and one for bikes would be `bike_stream`


<br>
 

## Activities

Activities are specific actions taken by an entity. For example, if the entity is a customer an activity could be 'opened an email' or 'submitted a support ticket'. Each row in a table modeled by an activity schema is a single instance of an activity taken by a specific entity.

Activities are intended to model real business processes. Taken together, the series of activities for a given entity would represent all relevant interactions that entity has had with a company. 

<br>


## Metadata

Every activity has metadata associated with it beyond the customer, the activity, and the timestamp. A 'viewed page' activity will want to store the actual page viewed, while an 'invoice paid' activity will store the total amount paid. 

- **ts:** Time is critical in understanding behavior
- **activity_id:** This paired with the activity gives us a unique id per row
- **revenue_impact:** This makes it really easy to understand bottom line impact
- **feature_json:** This allows us to add features that are specific to **just** that activity.
- **activity_occurrence:** This allows us to quickly use first, seconds, nth in queries
- **activity_repeated_at:** This allows us to create in_between queries and get last

 


<br>
<br>
<br>


# Structure

The primary benefit of an activity schema is that all data is in a consistent format. This means that it requires tables with specific names, types, and numbers of columns. 

<br>

## Tables

An activity schema uses a single table to store all activities. No new tables are created as the data evolves — any future activities will create rows in the same table. This is fundamentally distinct from other models, like a star schema, where each concept has its own 'fact' table. 


There are two types of tables in an Activity Schema

1. activity stream (one per activity schema)
2. entity table (optional - one per activity schema)


The activity stream table, (typically called `<entity>_stream`) stores all activities, their timestamps, the entity's identifier, and some metadata. 

The entity table (typically called `<entities>`) stores metadata for each entity. For example, a `customers` table can store date of birth, first and last name, etc.

The diagram below shows the two types of tables for our example bike stream. 

![bike_stream](https://user-images.githubusercontent.com/1216989/113031253-791e9c00-915c-11eb-8e84-bc743c8cafb8.png)


<br>

## Activity Stream

The activity stream table is the primary table in an activity schema and is the only one required. It houses the bulk of the modeled data in the warehouse. 

> As a reminder, you can create this table for each activity as a manaual partition

<br>


**Column**|**Description**|**Type**
-----|-----|-----
activity\_id|Unique identifier for the activity record|string
ts|Timestamp in UTC for when the activity occurred|timestamp
customer|Globally unique identifier for the customer|string
activity|Name of the activity (ex. 'completed\_order')|string
anonymous_customer\_id|A unique customer id specific to the source of this activity|string
feature\_json|Activity-specific feature 1|JSON
revenue\_impact|Revenue or cost associated with the activity|float
link|URL associated with the activity|string
activity\_occurrence|How many times this activity has happened for this customer. Used to streamline queries.|integer
activity\_repeated\_at|The timestamp of next instance of this activity for this customer. Used to streamline queries.|timestamp
\_activity\_source|The transformation script that created this activity|string



<br>



### **Types**

Exact types can differ depending on the warehouse. For the purposes of the activity schema, most column types are strings with a maximum length of 255 characters. This limit is in place for performance and to keep the activity stream table compact. Additional, unlimited metadata can be added in enrichment tables. 

- The `feature_json` column is type JSON but this is called SUPER in Redshift, OBJECT in snowflake.


- The **ts** and **activity_repeated_at** columns are timestamps with no time zone. Any type that specifies a specific date and time (it is TIMESTAMP for most warehouse), timezone independent, will work.

- By convention **ts** and **activity_repeated_at** are always understood to be in UTC. 


- The **revenue_impact** column is a real number (float, decimal, numeric etc). The exact type or  precision is unspecified. There is no dedicated field for currency type (i.e USD). A feature column can be used for this if necessary. 

- The **activity_occurrence** column is an integer. The integer size doesn't matter — a 8-byte integer is a sensible default.



<br>



### **Column Notes**

The `activity_id` can be any string as long as it's unique for the given activity. It is used to  identify a single activity instance. It can never be null.

<br>

The `activity` column is a simple string denoting the name of the activity — 'viewed_page' or 'opened_support_ticket'. By convention it's in the form verb_noun from the perspective of the entity — it should read as entity performed action. Any other form is fine as well. It's a best practice to use the same form across all activities when possible. It is case-sensitive and can never be null.

<br>

The `customer` column is the global identifier for the entity. It's typically an email address, but can be a phone number or serial number (eg. for a bike) or anything else that uniquely identifies the entity. IDs, uuids, and other computed identifiers ideally should be avoided, since they're not naturally unique. 

A single entity should have exactly one identifier in the activity stream across all their activities. In other words, don't mix multiple types of identifiers for different activities. A single entity cannot be identified with an email in one activity and a phone number in another. If so they will effectively be different entities. In fact, a given activity schema should only use **one** type of identifier for the `customer` column throughout. 

Note that the column name is always `customer` regardless of what kind of entity is modeled in a given activity stream. This is to keep the exact same structure for all activity stream tables. The more specific term 'customer' was chosen over the generic term 'entity', because in the vast majority of the time an entity is some form of customer.  For example, the diagram at the beginning of this section, showing a `bike_stream` table, has a `customer` column to represent bikes.

The customer column can only be null if `anonymous_customer_id` is not null. 

<br>

In some cases the desired customer identifier is not yet available. When that happens the `anonymous_custome_id` columns are used in its place. They allow the activity stream to store an alternate identifier for an entity — called a local identifier (in contrast to the global identifier in the `custome`r column).

For example, say we're tracking customer page views on a web site. Visits are typically anonymous, so trackers like Segment or Google Analytics assign a proprietary id to the site visitor. This allows them to track the same person across sessions, even if we know nothing else about them. 

In this situation, store that anonymous identifier in `anonymous_customer_id` to identify the type of anonymous identifier used — a good default is the name of the service providing it. For example, `'segment'||anonmous_id` or `'ga4'||unique_id`. 


When `customer` and `anonymous_customer_id` are all available it creates an association at a point in time denoted with `ts` that can be used for identity resolution: all previous activities with only `anonymous_customer_id` can now be understood to be from that customer. A common practice is to fill in the `customer` column in older records once that link has been established.


<Br>


The a `feature_json` column to house all activity specific fields.  It is very good practice to only put the data that was generated by the activity at that time.  

For example, if a *compled_order* happens, you can add the coupon_code, tax,etc.. It is **very bad** practice to add the first_touch_adshource or delivery_date or returned_at in the features since thos all can change or be derived from another activity.


<br>


The columns **revenue_impact** and **link** are two additional metadata fields that are commonly used. 

**revenue_impact** is a number that captures money coming in (or out). For example, a 'paid_invoice' activity would likely have revenue impact set to the invoice total. This field is frequently summed in aggregation queries to compute things like total revenue over a time period.

**link** is used to store a hyperlink relevant to the activity. For example, a 'submitted support ticket' activity could have a link to the actual support ticket in Zendesk. This provides one click access to the source record for the data, which helps immensely when exploring or debugging. 


<br>

**Additional Columns**

The activity schema contains two special columns used to make queries simpler and more performant. 

The column **activity_occurrence** represents the number of times a given entity has done that activity, at the time that activity occurred (starting with 1). **activity_repeated_at** is the timestamp of the next time that same activity occurred for that entity. Both should be NULL if another activity has not yet occurred.

Both **activity_occurrence** and **activity_repeated_at are** computed from the activity stream itself, so it's dependent on an implementation of the activity schema to fill them in. They rely on previous instances of a given activity, so should be computed after the activity is recorded and after a customer has been assigned. 

The **_activity_source** column is to help the implementation of an activity stream — it's metadata about how the activity stream itself is built, and is not used in querying. It records an identifier to the transformation script that created this activity. It's used by activity schema implementations to support incremental updates of the activity stream (identify all activity rows created by the given transformation, find the maximum timestamp, and insert new rows with a newer timestamp). 


<br>
<br>

### Performance

The activity stream table is designed for fast queries on common data warehouses like Redshift, BigQuery, and Snowflake. Nearly all modern data warehouses are [column-oriented](https://en.wikipedia.org/wiki/Column-oriented_DBMS) — tables with fewer columns and many rows perform fastest. In addition, the activity stream table typically only needs to be joined with itself when queried, which further increases performance over other modeling approaches.

That said, it's important to pick the correct sort / dist / partition / cluster / index (depending on warehouse technology) to ensure high performance. A detailed discussion is out of scope for this specification, but generally sorting / indexing by (**activity, ts, activity_occurrence**)** is a good starting point. 


<br>

### For single table

Redshift: 
 - diststyle="EVEN"
 - sortkey='"activity", "ts", "activity_occurrence"'


Athena
  - partitioned_by="activity VARCHAR(255), activity_occurrence INT, DATE(ts)"
			 
databricks
 - partition_by="activity, DATE(ts)"
 - cluster_by="customer, activity_occurrence"
 
bigquery
 - clusterkey="activity, activity_occurrence, customer"
 - partition_column="TIMESTAMP_TRUNC(ts, MONTH)"

snowflake
 - cluster_column="(activity, activity_occurrence in (1, NULL), activity_repeated_at is NULL, to_date(ts))"
 


<br>

### For manually partitioned (one table per activity)

redshift
 - diststyle="EVEN",
 - sortkey='"ts", "activity_occurrence"'

athena
 - partitioned_by="activity_occurrence INT, DATE(ts) DATE"

bigquery
 - clusterkey="activity_occurrence, customer"
 - partition_column="TIMESTAMP_TRUNC(ts, MONTH)"

snowflake
 - cluster_column="(activity_occurrence in (1, NULL), activity_repeated_at is NULL, to_date(ts))"



<br>
<br>


## Entity Table

The entity table stores an unlimited number of metadata columns. By convention it takes its name directly from the entity. For example, for an activity schema with an entity named 'customer', the table would be called `customers`. For an activity schema about bikes the table would be called `bikes`. 

Conceptually the table contains a primary key column to identify the unique customer and an unlimited amount of optional columns containing the metadata. This is similar to dimension tables in a star schema. When querying the activity schema this table can be joined in when required by using the entity identifier. 

The primary key column is the only required column and by convention is always named **customer** — the same name as the corresponding column in the activity stream. ****It must store the same entity identifier as the activity stream. 

```sql
SELECT * 
FROM bike_stream
LEFT JOIN customers 
	ON bike_stream.customer = bikes.customer
```




<br>
<br>


## Additional Metadata

An activity schema treats metadata slightly differently than other modeling approaches. The core difference is that activities are meant to be built independently of each other and with no consideration for the data questions they'll eventually answer. A good analogy is LEGO bricks: they have their own unique shape and are assembled together to create anything. They weren't designed ahead of time to only make a house or a boat or a robot. 

Wide tables (with lots of useful columns) are built only when querying the activity stream, not when defining activities. 

This all means that activities should only store metadata directly related to themselves — i.e. a 'bike_ride_ended' activity could have a 'distance_traveled' feature, but wouldn't have a 'num_trips_taken'. Similarly, a 'submitted_support_ticket' activity wouldn't have a 'last_product_purchased' feature on it. 

These additional features aren't needed because they can be 'borrowed' from other activities when querying the activity stream. The result is most (99%) of activities have three or fewer features, and wide tables can be easily generated at query-time by joining in other activities.



<br>
<br>


### Borrowing Features

Borrowing features is really another way of saying that activities can be assembled together to create any kind of wide table needed for analysis. It's common to join multiple activities together in a query to do this. 

Say we wanted to group all 'submitted_support_ticket' activities by the last product purchased.  Because all activities can be joined together over time, it's a fairly straightforward query join in the last completed_order before each submitted support ticket and select its 'product' feature. 

This approach is the recommended way to query more metadata than available in a single activity.


<br>
<br>


### Dimension Tables

You probably have other dimension tables that can be used with the Activity Stream, which we call enrichment.

For example, a products table may be joing to a `product_id` in the `feature_json` column. 

To make querying very consitent the `id` of the Dimension table will always be `enriched_activity_id` this makes these tables much easier to use without thinking about ids.


An dimension table is typically named after the activity it enriches, taking the structure `enriched_<activity>.`


<br>



**Column**|**Description**|**Type**
-----|-----|-----
enriched\_activity\_id|activity\_id of the activity (or activities) that this row will enrich|string
feature columns|(optional) These columns are the additional features used to enrich an activity or activities.|various



You can always bring the data into the activity stream by the following join:


```sql
LEFT JOIN enriched_pages AS e 
  ON (
	customer_stream.activity = 'viewed_page'  AND
	customer_streams.feature_json.page_id = e.enriched_activity_id 
  )
```



<br>
<br>


# Using an Activity Schema

An activity schema only has a single model table — the activity stream.  An activity stream table can be reassembled to generate any table for BI, reporting, and analysis. 

Using an activity schema in practice consists of two things

1. Modeling - transforming raw tables into an activity stream 
2. Querying - retrieving data from the activity stream for BI (aka running at analysis time)

Both are a bit different than in more traditional approaches, so it's worth looking at them in more detail

![image](https://user-images.githubusercontent.com/1216989/113029354-54292980-915a-11eb-974d-ac24677e7bda.png)

<br>

Modeling here is the step to transform source tables in a data warehouse into the activity stream format. Querying is running SQL queries against the activity stream table to generate tables, materialized views, etc to be used for BI. 

There is a strong separation between modeling and querying. Any changes to how activities are built has no downstream impact on the queries depending on them. This makes it extremely easy to keep up with changes in production systems. Any type of source data change — from a changed column to swapping out to a completely different system with a new set of tables — simply requires updating the activity, while changing **none** of the downstream queries. This makes each activity the actual source of truth for each concept in the warehouse.


<br>

## Modeling

An activity schema is built by running simple SQL queries to transform raw source data to the activity stream format. This process should be familiar — it is no different than the Transform step (T) of an ELT approach to data ingestion and modeling.

In an activity schema there is only a single model layer — the activity stream table, and the primary modeling concept is an activity (rather than a noun like an 'order' or an 'invoice'). 

The process is straightforward

1. choose your activities
2. find relevant raw table(s)
3. write a SQL query to create each activity


<br>


### Choose Activities

Not all raw tables are modeled directly. Instead of thinking about what to do with each raw table, it helps to first identify which activities make sense. Generally they'll map to well known business processes or customer touch points, all from the perspective of the entity. It's fairly easy to add new activities or to change them, so it's also a good idea to start with a question, figure out which activities are needed, and add those. Pretty quickly this will converge to a core set.

For example, for our bike sharing app some activities for the bike stream could be

1. ride started
2. ride ended
3. maintenance requested
4. moved to new location

Some activities for the customer could be

1. purchased daily pass
2. started ride
3. purchased yearly subscription
4. submitted maintenance request
5. viewed web page
6. opened ride app
7. viewed bike availability

Once the activities have been identified then it's usually fairly straightforward to find which source table(s) will be needed. The only requirement is that we can identify an entity, a relevant activity, and a timestamp. 

<br>
<br>


### SQL Transformations

SQL Transformations are short SQL queries that map from source data to the activity stream format. They are typically fairly small and easy to write. 

For example, this is how **completed_order** is built from Shopify data

```sql
SELECT
	 o.id AS activity_id

	 , o.processed_at AS ts

	 , NULL     AS anonymous_customer_id
	 , o.email  AS customer

	 , 'completed_order' AS activity
	 , object(
		'discount_code', d.code,
		'order_name', o.name
	)   AS feature_json

	 , (o.total_price - o.total_discounts) AS revenue_impact

FROM shopify.order AS o
LEFT JOIN shopify.order_discount_code d
	ON (d.order_id = o.id)

WHERE
	o.cancelled_at is NULL
	and o.email is not NULL
	and o.email <> ''
```

This SQL is pretty straightforward

1. the **completed_order** activity is defined independently — it doesn't have to join with any other tables. We just need to find the customer's unique identifier (in this case email)
2. activities generally conform to well-known business processes, so the data is frequently close to the desired format already

In practice nearly all transformation scripts are less than 30 lines and one or two joins. 

In addition, there's no reason that transformation scripts and activities have to be 1:1. For example, a 'received_email' activity could be defined from source tables from multiple systems. Or a single transformation can create multiple activities.


<br>
<br>





### Building an activity stream

Companies maintaining data models in their warehouse run scheduled tasks to keep all tables up to date. In practice, this is done with a periodically running scheduled task (using a tool like dbt) that carefully manages a graph of table dependencies.

The activity schema approach is effectively the same, only without the layers of dependencies. A common approach is to create a single SQL query per activity desired, and append the results of each query to the activity stream table. 

This approach also means that incremental updates to the activity stream are straightforward (identify all activity rows created by the given transformation, find the maximum timestamp, and insert rows with a newer timestamp).

<br>

**Basic Setup**

The easiest setup is to build a table per activity and materialize that activity and adding the `activity_occurrence` and `activity_repeated_at` via window functions.


<br>

**Intermediate Setup**

The Activity Schema is designed to be immutable so you can save a lot of money, speed and performance by doing **Incremental Updates**.  Then you can UPDATE the tabel for any difference in `activity_occurrence` or `activity_repeated_at`.

You need to be a bit careful with incremntal updates (look at the Narrator Automated processing)

<br>

**Automated Setup (Shameless Plug)**

Narrator has been pushing the Activity Schema for many years and has developed a bunch of helpful processing. 

1. Incremental Updates
2. Manual partitions / Single table
3. Nightly Reconcilation: If your incremental update drops a row because of your ETL then you can diff the data and insert anything that was missed
4. Weekly Historical Data checks: Randomly samples the data to see if any of the tables that your using got data in history
5. Identity Resolution: Mapping and updating the `anonymous_customer_id` to `customer` over time: multi-user, multi-device, changing mapping
6. Window Deletes: Allows you to delete a certain window of data then reinsert it on each updates
7. Aliasing Activites: Allows you to remap a `customer` to a new `customer` think of someone changing their email
8. Removelist Activiites: Allowing you to create an activity of customers and have those be removed from the stream
9. Many-to-many SQL to Activities: Allowing you to write multiple SQL tranformations per Activity or have 1 SQL query generate multiple activities. 

... and more 



<br>
<br>


## Querying

An activity schema differs in some fundamental ways to more traditional approaches

1. data is in a time-series format
2. queries only select from the activity stream table (and optionally join in dimension tables)
3. any activity can be related (joined) to any other activity using only the entity and timestamp

This means that querying is a bit different but substantially more powerful. 

An activity schema **does not require any foreign key joins.** All joins are self-joins to the activity_stream table, and they only use the entity and timestamp columns. This means there is **always** a way to relate **any data** in an activity schema to anything else. 

Another way of phrasing this is that

1. Any query can substitute different activities by merely changing the activity name(s) where present in the query
2. Any query can be run on any activity schema implementation (say at a different company) by substituting activities if necessary

> This means that someone could build a customer lifetime value analysis, and run it on any number of companies' data with minimal modification.

Or one could compute the conversion rate over time of one activity to another (what percent of signups converted to orders) then quickly substitute the activities to answer a related question (what percent of orders converted to another order). In existing approaches, this usually requires restructuring the query, and in some cases in-depth work to find the right foreign keys to join. 

Lastly, a consistent table structure coupled with easily-modified queries means that it is far more useful to automatically generate SQL than before. An activity schema is best queried by specifying which kinds of activities and relationships matter and allowing a system to generate the actual SQL. See the Known Implementations section for some examples.

To better explain the concepts above we'll show a few hand-built queries. 

<br>
<br>

### Basic Queries

Simple queries are largely the same. Let's take a hypothetical bike-sharing company as an example. The monthly number of day passes sold, along with revenue, is pretty straightforward.

```sql
SELECT
	DATE_TRUNC('month', ts) AS month,
	COUNT(1) as total_orders,
	SUM(revenue_impact) as total_revenue
FROM customer_stream AS c
**WHERE c.activity = 'purchased_day_pass'** 

GROUP BY month
ORDER BY month
```

It's fairly obvious that counting total yearly subscriptions instead of day passes simply requires substituting '**subscribed_to_yearly_pass**' for '**purchased_day_pass**'.  

```sql
SELECT
	DATE_TRUNC('month', ts) AS month,
	COUNT(1) as total_orders,
	SUM(revenue_impact) as total_revenue
FROM customer_stream AS c
**WHERE c.activity = 'subscribed_to_yearly_pass'** 
GROUP BY month
ORDER BY month
```

Now let's see how this works when relating multiple activities together. 

<br>
<br>


### First/Last -> 1 row per Customer

Often, we are trying a single row per customer to do customer analyses and this isn't easy in normal tables but it is super easy in the Activity Schema.  You can use **First** or **Last**.


For example, Lets say you want every new **visited_website** then you can simply use **FIRST**:


```sql
SELECT
	*
FROM customer_stream AS c
where c.activity = 'visited_website'
	and c.activity_occurrence = 1
```


Or if you want everyones current subsription, you may do **LAST** **updated_subscription** :

```sql
SELECT
	*
FROM company_stream AS c
where c.activity = 'updated_subscription'
	and c.activity_repeated_at is NULL
```


<br>
<br>


### Relationships (the alternate to JOINS)

When using multiple Activities, you will need to use **relationships** which are time based pivotes to create a table that captures the behavior that you are interested in. 

<br>

**The first Activity -> The Cohort**

The first activity, we call the cohort activity because it gives you the basic rows of the table.  EVERY additional activity that you append will **NOT** change the rows of the tables (No duplication or dropping rows by design!)

For examples below, we will use **visited_website** as the cohort activity 


<br>

**The relationships**

Check out the visual explaination on ActivitySchema.com/relationships!

1. **First Ever:** For every visit a customer has, add the **first** occurrence of the append activity.

	Ex.: **visited_website** append **First Ever** **called_us**: This will add the customer's first time calling on every row without caring if it happened before or after that specific website visit.


2. **Last Ever:** For every visit a customer has, add the **last** occurrence of the append activity.

	Ex.: **visited_website** append **Last Ever** **called_us**: This will add the customer's last time calling on every row without caring if it happened before or after that specific website visit.

3. **Last Before:**  For every visit a customer has, add the **last** time the activity was done before that specific activity

	Ex. **visited_webstite** append **Last Before** **updated_opportunity_stage**: This will add the stage of the customer at the moment they visited the website.  (This is really good for slowly changing dimensions)

4. **First After:** For every visit, give me the first time a customer does an activity after the visit

	Ex. **FIRST** **visited_webstite** append **First After** **signed_up**: This will grab every first visitor and give you if they converted to a sign up.    


5. **First In Between:** For every visit, give me the first time a customer does an activity before the next visit.

	Ex. **visited_webstite** append **First In Between** **Completed Order**: On every website visit, did the customer order before the next visit. (This is super powerful for event based conversion)


5. **Aggregate In Between:** FOR every visit, apply an agg function on all the occurrence of an activity before the next visit. 

	Ex. **visited_webstite** append **Aggregate In Between** **Viewed Page**: On every website visit, count the number of pages before the next visit.


5. **Aggregate In Before:** FOR every visit, apply an agg function on all the occurrence of an activity before the this visit. 

	Ex. **visited_webstite** append **Aggregate Before** **Completed Order**: On every website visit, sum the revenue that was spent on completed orders before this visit.



> The following are available but way less commonly used

8. **Last After**: For every visit, give me the last time a customer does an activity after after the visit

	Ex. **FIRST** **visited_webstite** append **Last After** **returned_item**: This will grab every first visitor and give you the last time they returned an item after their first visit.    


3. **First Before:**  For every visit a customer has, add the **first** time the activity was done before that specific activity

	Ex. **visited_webstite** append **First Before** **opened_email**: This will add the the first email that the customer got that got them that visit.


8. **Last In Between:** For every visit, give me the last time a customer does an activity before the next visit.

	Ex. **visited_webstite** append **Last In Between** **viewed_page**: On every website visit, what was the last page that they viewed before leaving.  




<br>

**The SQL**

SQL for these relationships is a bit tricky due to having to write time based queries then squash them.  

I recommend checking out Narrator's UI called Dataset that can auto generate these or using some of the following that have been built by the community:

Ergext: 

Bryce Codewell:


<br>
<br>




### Automatic SQL Generation

Though we gave hand-written examples, the single, fixed table approach of the activity schema is designed for automatic query generation. 

At its core, querying an activity schema is really about specifying a set of activities and how they relate. Expressing a query this way, and allowing a tool to generate the actual SQL, is far easier than writing it by hand. Activity stream queries are generally somewhat complex and very repetitive. 

And because the activity schema ensures all activities can relate to each other, **there are no queries that have to be hand-built**. As long as an activity exists, it can be used for querying, analysis, etc with no extra work. 

Implementations of an activity schema (see below) will often provide a UI for the user to select activities and the relationships between them, and automatically generate and run queries. 

<br>
<br>

# Known Activity Schema Implementations

[Narrator](https://www.narrator.ai) provides an implementation of the activity schema as a service, along with a full data platform to manage and query it.
