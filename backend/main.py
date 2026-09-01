from fastapi import FastAPI

app = FastAPI()


@app.get("/")
def home():
    return {
        "message": "DER-02 Backend is running!"
    }